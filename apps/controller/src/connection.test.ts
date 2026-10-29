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
    open = false;
    closed = false;
    sent: unknown[] = [];
    send(m: unknown): void {
      this.sent.push(m);
    }
    close(): void {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      this.emit('close');
    }
    /** The data channel opens. */
    opened(): void {
      this.open = true;
      this.emit('open');
    }
  }

  class FakePeer extends FakeEmitter {
    static last: FakePeer;
    open = false;
    destroyed = false;
    disconnected = false;
    conns: FakeConn[] = [];
    constructor() {
      super();
      FakePeer.last = this;
      queueMicrotask(() => {
        this.open = true;
        this.emit('open', 'phone-id');
      });
    }
    connect(): FakeConn {
      const c = new FakeConn();
      this.conns.push(c);
      return c;
    }
    reconnect(): void {}
    destroy(): void {
      this.destroyed = true;
    }
  }

  return { FakeConn, FakePeer };
});

vi.mock('peerjs', () => ({ Peer: FakePeer }));

import { connect, type Link } from './connection';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const state = { t: 'state', phase: 'lobby', isHost: false, position: 0, racers: 1, lap: 1, totalLaps: 3, item: null, itemIcon: null, rolling: false };

async function openLink(): Promise<{ link: Link; statuses: string[]; msgs: unknown[] }> {
  const statuses: string[] = [];
  const msgs: unknown[] = [];
  const link = connect('ABCD', { token: 'tok', name: 'Ada' }, (m) => msgs.push(m), (s) => statuses.push(s));
  await Promise.resolve(); // the Peer opens
  const c = FakePeer.last.conns[0];
  c.opened();
  return { link, statuses, msgs };
}

test('a TV that keeps talking keeps the link open', async () => {
  const { link, msgs } = await openLink();
  const c = FakePeer.last.conns[0];
  expect(c.sent).toEqual([{ t: 'hello', token: 'tok', name: 'Ada' }]);
  for (let i = 0; i < 20; i++) {
    vi.advanceTimersByTime(1000); // the TV resends state at least once a second
    c.emit('data', state);
  }
  expect(link.status).toBe('open');
  expect(c.closed).toBe(false);
  expect(msgs).toHaveLength(20);
  link.close();
});

test('5 s without a word from the TV: drop, show retrying, redial with the same hello', async () => {
  const { link, statuses } = await openLink();
  const first = FakePeer.last.conns[0];
  first.emit('data', state);
  vi.advanceTimersByTime(4500);
  expect(link.status).toBe('open');
  vi.advanceTimersByTime(1500);
  expect(first.closed).toBe(true);
  expect(link.status).toBe('retrying');
  expect(statuses).toEqual(['open', 'retrying']);
  vi.advanceTimersByTime(2000); // the usual retry delay
  const second = FakePeer.last.conns[1];
  expect(second).toBeDefined();
  second.opened();
  expect(second.sent).toEqual([{ t: 'hello', token: 'tok', name: 'Ada' }]);
  expect(link.status).toBe('open');
  link.close();
});

test('the silence clock starts when the channel opens, not when dialling', async () => {
  const statuses: string[] = [];
  const link = connect('ABCD', { token: 'tok', name: 'Ada' }, () => {}, (s) => statuses.push(s));
  await Promise.resolve();
  const c = FakePeer.last.conns[0];
  vi.advanceTimersByTime(8000); // slow to open, still within the 10 s dial timeout
  c.opened();
  vi.advanceTimersByTime(4000);
  expect(link.status).toBe('open');
  expect(c.closed).toBe(false);
  link.close();
});

test('close() stops the watchdog', async () => {
  const { link } = await openLink();
  const c = FakePeer.last.conns[0];
  link.close();
  const peer = FakePeer.last;
  vi.advanceTimersByTime(30000);
  expect(peer.conns).toHaveLength(1);
  expect(c.closed).toBe(true);
});

// keep the FakeConn type referenced for the hoisted class
void FakeConn;
