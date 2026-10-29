import { beforeEach, expect, test } from 'vitest';
import { KART_COLORS, NEUTRAL_INPUT, type ClientMsg, type InputSnapshot, type ServerMsg } from '@rc/shared';
import { buildTrack } from './track/track';
import { TRACK_V1 } from './track/trackDef';
import { Game } from './game';
import { PlayerRegistry } from './net/players';
import { KEYBOARD_TOKEN, Session } from './session';

const track = buildTrack(TRACK_V1);

/** Deterministic PRNG so bot personalities (and so these tests) are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type StateMsg = Extract<ServerMsg, { t: 'state' }>;

let sent: { token: string; msg: ServerMsg }[];
const send = (token: string, msg: ServerMsg): void => {
  sent.push({ token, msg });
};
const to = (token: string) => sent.filter((s) => s.token === token).map((s) => s.msg);
const statesTo = (token: string) => to(token).filter((m): m is StateMsg => m.t === 'state');
const lastState = (token: string): StateMsg | undefined => {
  const all = statesTo(token);
  return all[all.length - 1];
};

const gasRight: ClientMsg = { t: 'input', steer: 0.5, gas: true, brake: false, item: false };
const gasOnly: InputSnapshot = { steer: 0, gas: true, brake: false, item: false };

/** Fake clock (ms) handed to the session. */
let clock = 0;

function setup(maxBots = 6, keyboard?: { input(): InputSnapshot }) {
  const game = new Game(track);
  const registry = new PlayerRegistry();
  const session = new Session(game, registry, send, { maxBots, keyboard, now: () => clock, rand: mulberry32(42) });
  return { game, registry, session };
}

/** Steps the game with the session's drivers until `phase` (or a step limit). */
function stepUntil(game: Game, session: Session, phase: string, max = 600): void {
  for (let i = 0; i < max && game.race.phase !== phase; i++) game.step(1 / 60, (id) => session.driverFor(id));
}
function stepFor(game: Game, session: Session, steps: number): void {
  for (let i = 0; i < steps; i++) game.step(1 / 60, (id) => session.driverFor(id));
}

beforeEach(() => {
  sent = [];
  clock = 0;
});

test('hello → welcome with slot colour; 7th → lobbyFull', () => {
  const { session } = setup();
  for (let i = 0; i < 6; i++) {
    expect(session.onHello('t' + i, 'P' + i)).toBeNull();
    expect(to('t' + i)[0]).toEqual({ t: 'welcome', slot: i, color: KART_COLORS[i] });
  }
  expect(session.onHello('t6', 'Late')).toEqual({ t: 'lobbyFull' });
  expect(to('t6').filter((m) => m.t === 'welcome')).toEqual([]);
});

test('only host can start; start creates humans+bots karts and enters countdown', () => {
  const { game, session } = setup(2);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  session.onMessage('b', { t: 'start' });
  expect(game.race.phase).toBe('lobby');
  session.onMessage('a', { t: 'rematch' });
  expect(game.race.phase).toBe('lobby');
  session.onMessage('a', { t: 'start' });
  expect(game.race.phase).toBe('countdown');
  expect(game.karts.map((k) => k.id)).toEqual([0, 1, 2, 3]);
  expect(session.driverFor(0)).toMatchObject({ kind: 'human', name: 'Ada' });
  expect(session.driverFor(1)).toMatchObject({ kind: 'human', name: 'Bea' });
  expect(session.driverFor(2).kind).toBe('bot');
  expect(session.driverFor(3).kind).toBe('bot');
  // phones hear about the countdown straight away
  expect(lastState('a')?.phase).toBe('countdown');
  expect(lastState('b')?.phase).toBe('countdown');
});

test('kart count is capped at 6 and always covers the highest human slot', () => {
  const capped = setup(6);
  capped.session.onHello('a', 'Ada');
  capped.session.onMessage('a', { t: 'start' });
  expect(capped.game.karts).toHaveLength(6);

  const gap = setup(0);
  gap.session.onHello('a', 'Ada');
  gap.session.onHello('b', 'Bea');
  gap.session.onHello('c', 'Cy');
  gap.session.onDisconnect('b');
  clock = 15000;
  gap.session.syncPhones(); // lobby grace over: slot 1 is free, Cy stays in slot 2
  expect(gap.session.lobbySlots()[1]).toMatchObject({ name: '', bot: true }); // the gap gets a bot kart
  gap.session.onMessage('a', { t: 'start' });
  expect(gap.game.karts.map((k) => k.id)).toEqual([0, 1, 2]);
  expect(gap.session.driverFor(1).kind).toBe('bot');
  expect(gap.session.driverFor(2)).toMatchObject({ kind: 'human', name: 'Cy' });
});

test('phone input drives its kart only while racing', () => {
  const { game, session } = setup(1);
  session.onHello('a', 'Ada');
  session.onMessage('a', gasRight); // lobby: ignored
  expect(session.driverFor(0).input()).toEqual(NEUTRAL_INPUT);
  session.onMessage('a', { t: 'start' });
  session.onMessage('a', gasRight); // countdown: ignored
  expect(session.driverFor(0).input()).toEqual(NEUTRAL_INPUT);
  stepUntil(game, session, 'racing');
  expect(game.race.phase).toBe('racing');
  expect(session.driverFor(0).input()).toEqual(NEUTRAL_INPUT);

  session.onMessage('a', { t: 'input', ...gasOnly });
  session.onMessage('stranger', { t: 'input', steer: 1, gas: true, brake: false, item: false });
  expect(session.driverFor(0).input()).toEqual(gasOnly);
  expect(session.driverFor(1).input().gas).toBe(true); // slot 1 is a bot, not the stranger
  stepFor(game, session, 60);
  expect(game.karts[0].speed).toBeGreaterThan(5);
  expect(game.karts[1].speed).toBeGreaterThan(5); // the bot drives itself; 'stranger' steer=1 had no effect
});

test('disconnect mid-race → driverFor returns bot; rejoin with same token → human again, same kart', () => {
  const { game, session } = setup(4);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.onMessage('b', { t: 'input', ...gasOnly });
  expect(session.driverFor(1).input()).toEqual(gasOnly);

  session.onDisconnect('b');
  const bot = session.driverFor(1);
  expect(bot.kind).toBe('bot');
  expect(bot.name).toBe('Bea'); // the kart keeps its owner's name while a bot drives it
  expect(bot.input().gas).toBe(true); // the bot takes over the dropped player's kart and drives it
  session.onMessage('b', { t: 'input', ...gasOnly }); // late packet from a dropped phone
  expect(session.driverFor(1).kind).toBe('bot');

  sent = [];
  expect(session.onHello('b', 'Bea')).toBeNull();
  expect(to('b')[0]).toEqual({ t: 'welcome', slot: 1, color: KART_COLORS[1] });
  expect(session.driverFor(1)).toMatchObject({ kind: 'human', name: 'Bea' });
  expect(session.driverFor(1).input()).toEqual(NEUTRAL_INPUT); // no stale input from before the drop
  expect(game.karts).toHaveLength(6);
  expect(lastState('b')?.phase).toBe('racing');
});

test('new phone mid-race takes over a bot kart in a free slot', () => {
  const { game, session } = setup(5);
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  expect(session.driverFor(1).kind).toBe('bot');

  expect(session.onHello('c', 'Cy')).toBeNull();
  expect(to('c')[0]).toEqual({ t: 'welcome', slot: 1, color: KART_COLORS[1] });
  expect(session.driverFor(1)).toMatchObject({ kind: 'human', name: 'Cy' });
  session.onMessage('c', { t: 'input', ...gasOnly });
  stepFor(game, session, 60);
  expect(game.karts[1].speed).toBeGreaterThan(5);
  expect(game.karts).toHaveLength(6);
});

test('a phone in a slot with no kart gets position 0 and its kart at the rematch', () => {
  const { game, session } = setup(0);
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'start' });
  expect(game.karts).toHaveLength(1);
  session.onHello('c', 'Cy'); // slot 1: no kart this race
  expect(game.karts).toHaveLength(1);
  expect(lastState('c')).toMatchObject({ phase: 'countdown', position: 0, racers: 1 });
  game.race.phase = 'results';
  session.onMessage('a', { t: 'rematch' });
  expect(game.karts.map((k) => k.id)).toEqual([0, 1]);
  expect(session.driverFor(1)).toMatchObject({ kind: 'human', name: 'Cy' });
});

test('host leaves → next player state has isHost true', () => {
  const { game, session } = setup(4);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  session.syncPhones();
  expect(lastState('a')?.isHost).toBe(true);
  expect(lastState('b')?.isHost).toBe(false);
  session.onDisconnect('a');
  session.syncPhones();
  expect(lastState('b')?.isHost).toBe(true);
  // the new host can start
  session.onMessage('b', { t: 'start' });
  expect(game.race.phase).toBe('countdown');
});

test('host leaving mid-race passes host on; the old host rejoining is host again (earliest join)', () => {
  const { game, session } = setup(4);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.onDisconnect('a');
  session.syncPhones();
  expect(lastState('b')?.isHost).toBe(true);
  session.onHello('a', 'Ada');
  session.syncPhones();
  // joinOrder is kept on rejoin, so Ada is the earliest connected player again
  expect(lastState('a')?.isHost).toBe(true);
  expect(lastState('b')?.isHost).toBe(false);
});

test('syncPhones also resends unchanged state once a second, as a heartbeat for the phones', () => {
  const { session } = setup(4);
  session.onHello('a', 'Ada');
  const base = statesTo('a').length;
  for (let t = 100; t < 1000; t += 100) {
    clock = t;
    session.syncPhones();
  }
  expect(statesTo('a').length).toBe(base);
  clock = 1000;
  session.syncPhones();
  expect(statesTo('a').length).toBe(base + 1);
  clock = 1500;
  session.onHello('b', 'Bea'); // a change goes out at once (racers: 2) and restarts the second
  expect(statesTo('a').length).toBe(base + 2);
  clock = 2400;
  session.syncPhones();
  expect(statesTo('a').length).toBe(base + 2);
  clock = 2500;
  session.syncPhones();
  expect(statesTo('a').length).toBe(base + 3);
  expect(lastState('a')?.racers).toBe(2);
});

test('a host who drops in the lobby keeps slot and host turn for 15 s', () => {
  const { session } = setup(4);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  clock = 1000;
  session.onDisconnect('a');
  expect(lastState('b')?.isHost).toBe(true); // a disconnected player is never host
  expect(session.lobbySlots()[0]).toEqual({ name: 'Ada', color: KART_COLORS[0], bot: true, host: false });
  clock = 10000;
  session.syncPhones();
  session.onHello('c', 'Cy');
  expect(to('c')[0]).toMatchObject({ slot: 2 }); // Ada's slot is still held
  sent = [];
  expect(session.onHello('a', 'Ada')).toBeNull();
  expect(to('a')[0]).toEqual({ t: 'welcome', slot: 0, color: KART_COLORS[0] });
  expect(lastState('a')?.isHost).toBe(true);
  expect(lastState('b')?.isHost).toBe(false);
});

test('after the lobby grace a dropped player is removed and their slot freed', () => {
  const { game, session } = setup(0);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  expect(game.karts).toHaveLength(2);
  session.onDisconnect('b');
  clock = 14999;
  session.syncPhones();
  expect(session.lobbySlots()[1].name).toBe('Bea');
  clock = 15000;
  session.syncPhones();
  expect(session.lobbySlots()[1]).toMatchObject({ name: '', bot: false });
  expect(game.karts).toHaveLength(1); // the lobby grid preview follows
  expect(lastState('a')?.racers).toBe(1);
  sent = [];
  session.onHello('b', 'Bea'); // a fresh join now
  expect(to('b')[0]).toMatchObject({ slot: 1 });
});

test('a network hello with the keyboard token is rejected', () => {
  const { registry, session } = setup(4, { input: () => NEUTRAL_INPUT });
  expect(session.onHello(KEYBOARD_TOKEN, 'Sneaky')).toEqual({ t: 'lobbyFull' });
  expect(registry.byToken(KEYBOARD_TOKEN)?.name).toBe('Keyboard');
  const noKeys = setup(4);
  expect(noKeys.session.onHello(KEYBOARD_TOKEN, 'Sneaky')).toEqual({ t: 'lobbyFull' });
  expect(noKeys.registry.all()).toEqual([]);
});

test('syncPhones sends state only when changed', () => {
  const { session } = setup(4);
  session.onHello('a', 'Ada');
  session.syncPhones();
  const first = statesTo('a').length;
  expect(first).toBeGreaterThan(0);
  expect(lastState('a')).toEqual({
    t: 'state',
    phase: 'lobby',
    isHost: true,
    position: 0,
    racers: 1,
    lap: 1,
    totalLaps: 3,
    item: null,
    itemIcon: null,
    rolling: false,
  });
  session.syncPhones();
  session.syncPhones();
  expect(statesTo('a').length).toBe(first);
  session.onHello('b', 'Bea');
  session.syncPhones();
  expect(statesTo('a').length).toBe(first + 1);
  expect(lastState('a')?.racers).toBe(2);
});

test('racing state carries position from the ranking and the lap', () => {
  const { game, session } = setup(1);
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.onMessage('a', { t: 'input', ...gasOnly });
  stepFor(game, session, 90);
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ phase: 'racing', position: 1, racers: 2, lap: 1 });
  // put the kart behind the bot
  game.karts[0].distance = game.karts[1].distance - 1;
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ position: 2 });
  game.karts[0].distance = track.length + 5;
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ position: 1, lap: 2 });
});

test('rematch from results: host only, same lineup back on the grid, straight to countdown', () => {
  const { game, session } = setup(2);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.onMessage('a', { t: 'input', ...gasOnly });
  stepFor(game, session, 60);
  session.onDisconnect('b'); // keeps slot 1; a bot drives it
  game.race.phase = 'results';
  session.onMessage('a', { t: 'start' }); // wrong message for results
  expect(game.race.phase).toBe('results');
  session.onHello('c', 'Cy'); // takes slot 2 (b keeps slot 1)
  session.onMessage('c', { t: 'rematch' }); // not host
  expect(game.race.phase).toBe('results');
  session.onMessage('a', { t: 'rematch' });
  expect(game.race.phase).toBe('countdown');
  expect(game.karts.map((k) => k.id)).toEqual([0, 1, 2, 3]);
  expect(game.karts[0].pos).toEqual(track.grid[0].pos);
  expect(game.karts[0].speed).toBe(0);
  expect(session.driverFor(1)).toMatchObject({ kind: 'bot', name: 'Bea' });
  expect(session.driverFor(2)).toMatchObject({ kind: 'human', name: 'Cy' });
  expect(session.driverFor(0).input()).toEqual(NEUTRAL_INPUT); // race inputs are cleared
});

test('sendEvent goes to the phone driving that kart only', () => {
  const { session } = setup(2);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  session.onMessage('a', { t: 'start' });
  sent = [];
  session.sendEvent(1, 'finish');
  session.sendEvent(3, 'finish'); // bot kart: nobody to tell
  expect(sent).toEqual([{ token: 'b', msg: { t: 'event', kind: 'finish' } }]);
  session.onDisconnect('b');
  sent = [];
  session.sendEvent(1, 'hit');
  expect(sent).toEqual([]);
});

test('keyboard is player "Keyboard" in slot 0, host, and drives kart 0', () => {
  const keys = { input: (): InputSnapshot => gasOnly };
  const { game, registry, session } = setup(1, keys);
  expect(registry.byToken(KEYBOARD_TOKEN)).toMatchObject({ name: 'Keyboard', slot: 0, connected: true });
  expect(session.onHello('a', 'Ada')).toBeNull();
  expect(to('a')[0]).toMatchObject({ slot: 1 });
  session.syncPhones();
  expect(lastState('a')?.isHost).toBe(false);
  expect(to(KEYBOARD_TOKEN)).toEqual([]); // nothing is sent to the keyboard
  session.onMessage(KEYBOARD_TOKEN, { t: 'start' });
  expect(game.race.phase).toBe('countdown');
  expect(game.karts).toHaveLength(3);
  expect(session.driverFor(0)).toMatchObject({ kind: 'human', name: 'Keyboard' });
  expect(session.driverFor(0).input()).toEqual(gasOnly);
});

test('lobbySlots: players with host flag, bot slots up to the kart count, then free slots', () => {
  const { session } = setup(2);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  expect(session.lobbySlots()).toEqual([
    { name: 'Ada', color: KART_COLORS[0], bot: false, host: true },
    { name: 'Bea', color: KART_COLORS[1], bot: false, host: false },
    { name: '', color: KART_COLORS[2], bot: true, host: false },
    { name: '', color: KART_COLORS[3], bot: true, host: false },
    { name: '', color: KART_COLORS[4], bot: false, host: false },
    { name: '', color: KART_COLORS[5], bot: false, host: false },
  ]);
});

test('bots drive: empty slots and a dropped player\'s kart advance on their own and keep going', () => {
  const { game, session } = setup(4);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.onDisconnect('b');
  const start = game.karts.map((k) => k.distance);
  stepFor(game, session, 60 * 12);
  for (const id of [1, 2, 3]) {
    expect(game.karts[id].distance - start[id], `kart ${id}`).toBeGreaterThan(100);
    expect(game.karts[id].speed, `kart ${id}`).toBeGreaterThan(8);
  }
  // Ada is a human sending nothing: no bot drives her kart (bumps from passing bots may nudge it).
  expect(session.driverFor(0)).toMatchObject({ kind: 'human' });
  expect(session.driverFor(0).input()).toEqual(NEUTRAL_INPUT);
});

test('every kart has a brain at race start, including human slots, and a rematch gives fresh ones', () => {
  const { game, session } = setup(2);
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.onDisconnect('a'); // human slot 0 is now a bot
  stepFor(game, session, 30);
  expect(game.karts[0].speed).toBeGreaterThan(0);
  for (const k of game.karts) {
    k.distance = 3 * track.length + 1; // everyone done
    k.finishedAt = 1;
  }
  stepUntil(game, session, 'results', 600);
  expect(game.race.phase).toBe('results');
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'rematch' });
  stepUntil(game, session, 'racing');
  stepFor(game, session, 60 * 5);
  for (const k of game.karts.slice(1)) expect(k.speed, `kart ${k.id}`).toBeGreaterThan(8);
});
