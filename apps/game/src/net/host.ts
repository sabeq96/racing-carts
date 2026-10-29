import { Peer, type DataConnection } from 'peerjs';
import { decodeClient, makeRoomCode, peerIdFor, type ClientMsg, type ServerMsg } from '@rc/shared';

export interface HostHandlers {
  /** Every decoded message after hello. `hello` itself is handled here and surfaced as onHello. */
  onMessage(token: string, msg: ClientMsg): void;
  /** Return `{ t: 'lobbyFull' }` to reject (host sends it and closes the connection), else null. */
  onHello(token: string, name: string): ServerMsg | null;
  onDisconnect(token: string): void;
}

export interface NetHost {
  code: string;
  send(token: string, msg: ServerMsg): void;
  close(): void;
}

const MAX_CODE_ATTEMPTS = 20;
const RECONNECT_MS = 5000;
const REJECT_CLOSE_MS = 200;
const BROKER_ERRORS = new Set(['network', 'server-error', 'socket-error']);
/**
 * A phone that vanishes (tab closed, screen locked, out of wifi) may never fire `close` on the TV's
 * side of the data channel. Phones send `input` at 30 Hz in every phase, so this much silence after
 * hello means the phone is gone: close the connection (it redials with the same token if it was only
 * asleep). The clock starts when the data channel opens, so slow networks (TURN, mobile data) can join.
 */
const SILENCE_MS = 6000;
/** An open connection gets this long to say hello. */
const HELLO_MS = 15000;
const SILENCE_CHECK_MS = 1000;

/** Opens a Peer under a fresh room code, retrying while the code is taken. */
function openPeer(rand?: () => number): Promise<{ peer: Peer; code: string }> {
  return new Promise((resolve, reject) => {
    const attempt = (n: number): void => {
      const code = makeRoomCode(rand);
      const peer = new Peer(peerIdFor(code));
      let settled = false;
      peer.on('open', () => {
        settled = true;
        resolve({ peer, code });
      });
      peer.on('error', (err) => {
        if (settled) return; // after opening, per-connection problems must not take the room down
        const type = String(err.type);
        if (type === 'unavailable-id' && n < MAX_CODE_ATTEMPTS) {
          settled = true;
          peer.destroy();
          attempt(n + 1);
        } else {
          settled = true;
          peer.destroy();
          reject(new Error(BROKER_ERRORS.has(type) ? 'broker-unreachable' : type));
        }
      });
    };
    attempt(1);
  });
}

export async function startHost(handlers: HostHandlers, rand?: () => number): Promise<NetHost> {
  const { peer, code } = await openPeer(rand);
  const conns = new Map<string, DataConnection>();
  /**
   * Every connection → when it last sent anything (null until its data channel opens), its limit
   * (HELLO_MS before hello, SILENCE_MS after) and how to drop it. `performance.now()` is monotonic,
   * so a wall-clock change on the TV cannot drop everyone at once.
   */
  const live = new Map<DataConnection, { lastSeen: number | null; limit: number; drop: () => void }>();
  const silenceTimer = setInterval(() => {
    const now = performance.now();
    for (const l of live.values()) if (l.lastSeen !== null && now - l.lastSeen > l.limit) l.drop();
  }, SILENCE_CHECK_MS);

  // The broker socket can drop during a long session; keep the room reachable.
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleReconnect = (): void => {
    if (reconnectTimer !== null || peer.destroyed || !peer.disconnected) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (peer.destroyed || !peer.disconnected) return;
      try {
        peer.reconnect();
      } catch {
        // retried below
      }
      scheduleReconnect();
    }, RECONNECT_MS);
  };
  peer.on('disconnected', scheduleReconnect);

  peer.on('connection', (conn) => {
    let token: string | null = null;
    let rejected = false;

    const dropped = (): void => {
      live.delete(conn);
      if (token !== null && conns.get(token) === conn) {
        conns.delete(token);
        handlers.onDisconnect(token);
      }
    };
    const entry = {
      lastSeen: conn.open ? performance.now() : (null as number | null),
      limit: HELLO_MS,
      drop: (): void => {
        live.delete(conn);
        try {
          conn.close();
        } catch {
          // already gone
        }
        dropped(); // `close` may not fire for a dead channel; dropped() is idempotent
      },
    };
    live.set(conn, entry);
    conn.on('open', () => {
      entry.lastSeen = performance.now();
    });

    conn.on('data', (raw) => {
      entry.lastSeen = performance.now();
      if (rejected) return;
      const msg = decodeClient(raw);
      if (token === null) {
        // First message must be a valid hello.
        if (!msg || msg.t !== 'hello') {
          rejected = true;
          conn.close();
          return;
        }
        // Register before onHello so the handler can send (e.g. welcome) to this token.
        const previous = conns.get(msg.token);
        token = msg.token;
        conns.set(token, conn);
        const reply = handlers.onHello(msg.token, msg.name);
        if (reply && reply.t === 'lobbyFull') {
          if (previous) conns.set(msg.token, previous);
          else conns.delete(msg.token);
          token = null;
          rejected = true;
          conn.send(reply);
          // Let the message flush before closing.
          setTimeout(() => conn.close(), REJECT_CLOSE_MS);
          return;
        }
        if (previous && previous !== conn) previous.close(); // its close event is ignored: no longer current
        entry.limit = SILENCE_MS;
        return;
      }
      if (!msg || msg.t === 'hello') return;
      if (conns.get(token) !== conn) return; // stale connection replaced by a newer one
      handlers.onMessage(token, msg);
    });
    conn.on('close', dropped);
    conn.on('error', dropped);
  });

  return {
    code,
    send(t, msg) {
      const conn = conns.get(t);
      if (conn && conn.open) conn.send(msg);
    },
    close() {
      clearInterval(silenceTimer);
      live.clear();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      conns.clear();
      peer.destroy();
    },
  };
}
