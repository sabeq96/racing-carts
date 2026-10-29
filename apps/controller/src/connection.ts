import { Peer, type DataConnection } from 'peerjs';
import { decodeServer, peerIdFor, type ClientMsg, type ServerMsg } from '@rc/shared';

export interface Link {
  send(msg: ClientMsg): void;
  /** Stops retrying and tears the Peer down. */
  close(): void;
  status: 'connecting' | 'open' | 'retrying';
}

const RETRY_MS = 2000;
const DIAL_TIMEOUT_MS = 10000;

/**
 * Connects to the TV host for `code`. Sends `hello` every time the data channel opens, and keeps
 * retrying every 2 s (reusing the Peer unless it was destroyed) when the channel closes or errors.
 */
export function connect(
  code: string,
  hello: { token: string; name: string },
  onMsg: (m: ServerMsg) => void,
  onStatus: (s: Link['status']) => void,
): Link {
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let dialTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const link: Link = {
    status: 'connecting',
    send(msg) {
      if (link.status !== 'open' || !conn || !conn.open) return;
      try {
        conn.send(msg);
      } catch {
        // channel died between the check and the send; the close handler will retry
      }
    },
    close() {
      closed = true;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      dropConn();
      peer?.destroy();
      peer = null;
    },
  };

  const setStatus = (s: Link['status']): void => {
    if (link.status === s) return;
    link.status = s;
    onStatus(s);
  };

  const dropConn = (): void => {
    clearTimeout(dialTimer);
    const old = conn;
    conn = null;
    if (old) {
      try {
        old.close();
      } catch {
        // already closed
      }
    }
  };

  const scheduleRetry = (): void => {
    if (closed) return;
    dropConn();
    setStatus('retrying');
    if (retryTimer !== undefined) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      attempt();
    }, RETRY_MS);
  };

  const dial = (): void => {
    if (!peer || conn) return;
    const c = peer.connect(peerIdFor(code), { serialization: 'json' });
    conn = c;
    dialTimer = setTimeout(() => {
      if (conn === c && !c.open) scheduleRetry();
    }, DIAL_TIMEOUT_MS);
    c.on('open', () => {
      if (conn !== c) return;
      clearTimeout(dialTimer);
      c.send({ t: 'hello', token: hello.token, name: hello.name } satisfies ClientMsg);
      setStatus('open');
    });
    c.on('data', (raw) => {
      if (conn !== c) return;
      const m = decodeServer(raw);
      if (m) onMsg(m);
    });
    c.on('close', () => {
      if (conn === c) scheduleRetry();
    });
    c.on('error', () => {
      if (conn === c) scheduleRetry();
    });
  };

  const attempt = (): void => {
    if (closed) return;
    if (!peer || peer.destroyed) {
      conn = null;
      const p = new Peer();
      peer = p;
      p.on('open', () => {
        if (peer === p) dial();
      });
      p.on('error', () => {
        // e.g. peer-unavailable while the TV is not up yet; a live data channel is left alone
        if (peer === p && !conn?.open) scheduleRetry();
      });
      p.on('disconnected', () => {
        // lost the signalling broker: an open data channel keeps working, so just re-register
        if (peer === p && !conn?.open) scheduleRetry();
        else setTimeout(() => peer === p && !p.destroyed && p.disconnected && p.reconnect(), RETRY_MS);
      });
      return;
    }
    if (peer.disconnected) {
      peer.reconnect();
    } else if (peer.open) {
      dial();
    }
  };

  attempt();
  return link;
}
