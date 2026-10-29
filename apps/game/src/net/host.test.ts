import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { FakeConn, FakePeer } = vi.hoisted(() => {
type Listener = (...args: any[]) => void;

class FakeEmitter {
  private listeners = new Map<string, Listener[]>();
  on(ev: string, fn: Listener): this {
    this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn]);
    return this;
  }
  emit(ev: string, ...args: any[]): void {
    for (const fn of this.listeners.get(ev) ?? []) fn(...args);
  }
}

class FakeConn extends FakeEmitter {
  open = true;
  sent: unknown[] = [];
  closed = false;
  send(m: unknown): void {
    this.sent.push(m);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
  }
}

class FakePeer extends FakeEmitter {
  static last: FakePeer;
  disconnected = false;
  destroyed = false;
  reconnects = 0;
  constructor(public id: string) {
    super();
    FakePeer.last = this;
    queueMicrotask(() => this.emit('open', id));
  }
  reconnect(): void {
    this.reconnects++;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

  return { FakeConn, FakePeer };
});

vi.mock('peerjs', () => ({ Peer: FakePeer }));

import { startHost } from './host';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const hello = (token: string) => ({ t: 'hello', token, name: 'N' });

test('send inside onHello reaches the connection', async () => {
  let host!: Awaited<ReturnType<typeof startHost>>;
  host = await startHost({
    onHello: (token) => {
      host.send(token, { t: 'welcome', slot: 0, color: '#FF8A80' });
      return null;
    },
    onMessage: () => {},
    onDisconnect: () => {},
  });
  const conn = new FakeConn();
  FakePeer.last.emit('connection', conn);
  conn.emit('data', hello('a'));
  expect(conn.sent).toEqual([{ t: 'welcome', slot: 0, color: '#FF8A80' }]);
});

test('lobbyFull is sent, connection closes, onDisconnect not fired, later data ignored', async () => {
  const onDisconnect = vi.fn();
  const onMessage = vi.fn();
  const onHello = vi.fn(() => ({ t: 'lobbyFull' }) as const);
  const host = await startHost({ onHello, onMessage, onDisconnect });
  const conn = new FakeConn();
  FakePeer.last.emit('connection', conn);
  conn.emit('data', hello('a'));
  expect(conn.sent).toEqual([{ t: 'lobbyFull' }]);
  conn.emit('data', hello('a'));
  conn.emit('data', { t: 'start' });
  expect(onHello).toHaveBeenCalledTimes(1);
  expect(onMessage).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(conn.closed).toBe(true);
  expect(onDisconnect).not.toHaveBeenCalled();
  host.send('a', { t: 'lobbyFull' });
  expect(conn.sent).toHaveLength(1);
});

test('rejected hello for a known token keeps the previous connection', async () => {
  let reject = false;
  const onDisconnect = vi.fn();
  const host = await startHost({
    onHello: () => (reject ? { t: 'lobbyFull' } : null),
    onMessage: () => {},
    onDisconnect,
  });
  const old = new FakeConn();
  FakePeer.last.emit('connection', old);
  old.emit('data', hello('a'));
  reject = true;
  const fresh = new FakeConn();
  FakePeer.last.emit('connection', fresh);
  fresh.emit('data', hello('a'));
  vi.advanceTimersByTime(300);
  expect(old.closed).toBe(false);
  host.send('a', { t: 'event', kind: 'hit' });
  expect(old.sent).toEqual([{ t: 'event', kind: 'hit' }]);
  expect(onDisconnect).not.toHaveBeenCalled();
});

test('newer connection replaces old one without onDisconnect; current close disconnects', async () => {
  const onDisconnect = vi.fn();
  await startHost({ onHello: () => null, onMessage: () => {}, onDisconnect });
  const a = new FakeConn();
  const b = new FakeConn();
  FakePeer.last.emit('connection', a);
  a.emit('data', hello('t'));
  FakePeer.last.emit('connection', b);
  b.emit('data', hello('t'));
  expect(a.closed).toBe(true);
  expect(onDisconnect).not.toHaveBeenCalled();
  b.close();
  expect(onDisconnect).toHaveBeenCalledWith('t');
});

test('non-hello first message closes the connection', async () => {
  const onHello = vi.fn(() => null);
  await startHost({ onHello, onMessage: () => {}, onDisconnect: () => {} });
  const c = new FakeConn();
  FakePeer.last.emit('connection', c);
  c.emit('data', { t: 'start' });
  expect(c.closed).toBe(true);
  expect(onHello).not.toHaveBeenCalled();
});

test('broker drop triggers reconnect every 5 s until reconnected', async () => {
  const host = await startHost({ onHello: () => null, onMessage: () => {}, onDisconnect: () => {} });
  const peer = FakePeer.last;
  peer.disconnected = true;
  peer.emit('disconnected');
  vi.advanceTimersByTime(5000);
  expect(peer.reconnects).toBe(1);
  vi.advanceTimersByTime(5000);
  expect(peer.reconnects).toBe(2);
  peer.disconnected = false;
  vi.advanceTimersByTime(10000);
  expect(peer.reconnects).toBe(2);
  host.close();
});

const input = { t: 'input', steer: 0, gas: false, brake: false, item: false };

/** A connection as PeerJS hands it to the host: the data channel is not open yet. */
function pendingConn(): InstanceType<typeof FakeConn> {
  const c = new FakeConn();
  c.open = false;
  return c;
}
function openConn(c: InstanceType<typeof FakeConn>): void {
  c.open = true;
  c.emit('open');
}

test('a slow-opening connection (over 4 s) is not dropped and can join', async () => {
  const onDisconnect = vi.fn();
  const onHello = vi.fn(() => null);
  await startHost({ onHello, onMessage: () => {}, onDisconnect });
  const c = pendingConn();
  FakePeer.last.emit('connection', c);
  vi.advanceTimersByTime(20000); // TURN / mobile data can take a while to open the channel
  expect(c.closed).toBe(false);
  openConn(c);
  vi.advanceTimersByTime(4000);
  c.emit('data', hello('a'));
  expect(c.closed).toBe(false);
  expect(onHello).toHaveBeenCalledWith('a', 'N');
  expect(onDisconnect).not.toHaveBeenCalled();
});

test('an open connection that never says hello is closed after 15 s', async () => {
  const onDisconnect = vi.fn();
  await startHost({ onHello: () => null, onMessage: () => {}, onDisconnect });
  const c = pendingConn();
  FakePeer.last.emit('connection', c);
  vi.advanceTimersByTime(3000);
  openConn(c);
  vi.advanceTimersByTime(14000);
  expect(c.closed).toBe(false);
  vi.advanceTimersByTime(2000);
  expect(c.closed).toBe(true);
  expect(onDisconnect).not.toHaveBeenCalled();
});

test('after hello, 6 s of silence drops the phone once; regular input keeps it', async () => {
  const onDisconnect = vi.fn();
  const host = await startHost({ onHello: () => null, onMessage: () => {}, onDisconnect });
  const c = pendingConn();
  FakePeer.last.emit('connection', c);
  openConn(c);
  c.emit('data', hello('a'));
  for (let i = 0; i < 100; i++) {
    vi.advanceTimersByTime(100);
    c.emit('data', input);
  }
  vi.advanceTimersByTime(5500);
  expect(onDisconnect).not.toHaveBeenCalled();
  expect(c.closed).toBe(false);
  vi.advanceTimersByTime(1500);
  expect(onDisconnect).toHaveBeenCalledTimes(1);
  expect(onDisconnect).toHaveBeenCalledWith('a');
  expect(c.closed).toBe(true);
  vi.advanceTimersByTime(10000);
  expect(onDisconnect).toHaveBeenCalledTimes(1);
  host.close();
});
