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
const BROKER_ERRORS = new Set(['network', 'server-error', 'socket-error']);

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

  peer.on('connection', (conn) => {
    let token: string | null = null;

    const dropped = (): void => {
      if (token !== null && conns.get(token) === conn) {
        conns.delete(token);
        handlers.onDisconnect(token);
      }
    };

    conn.on('data', (raw) => {
      const msg = decodeClient(raw);
      if (token === null) {
        // First message must be a valid hello.
        if (!msg || msg.t !== 'hello') {
          conn.close();
          return;
        }
        const reply = handlers.onHello(msg.token, msg.name);
        if (reply && reply.t === 'lobbyFull') {
          conn.send(reply);
          // Let the message flush before closing.
          setTimeout(() => conn.close(), 200);
          return;
        }
        const previous = conns.get(msg.token);
        token = msg.token;
        conns.set(token, conn);
        if (previous && previous !== conn) previous.close(); // its close event is ignored: no longer current
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
      conns.clear();
      peer.destroy();
    },
  };
}
