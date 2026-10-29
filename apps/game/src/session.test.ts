import { beforeEach, expect, test } from 'vitest';
import { KART_COLORS, NEUTRAL_INPUT, type ClientMsg, type InputSnapshot, type ServerMsg } from '@rc/shared';
import { buildTrack } from './track/track';
import { TRACK_V1 } from './track/trackDef';
import { Game } from './game';
import { PlayerRegistry } from './net/players';
import { KEYBOARD_TOKEN, Session } from './session';
import { mulberry32 } from './test/rand';

const track = buildTrack(TRACK_V1);

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
  // Seeded item rolls too, so bots fire the same mines and rockets every run.
  const game = new Game(track, mulberry32(7));
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
    drift: 0,
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
  // Bea left before the rematch: her slot is freed and a plain bot drives kart 1.
  expect(session.driverFor(1)).toMatchObject({ kind: 'bot', name: 'Sky' });
  expect(session.driverFor(2)).toMatchObject({ kind: 'human', name: 'Cy' });
  expect(session.driverFor(0).input()).toEqual(NEUTRAL_INPUT); // race inputs are cleared
});

test('rematch drops players who left; a returning phone rejoins into a free slot', () => {
  const joins: string[] = [];
  const game = new Game(track, mulberry32(7));
  const registry = new PlayerRegistry();
  const session = new Session(game, registry, send, {
    maxBots: 0,
    now: () => clock,
    rand: mulberry32(42),
    onJoin: (t) => joins.push(t),
  });
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  session.onHello('c', 'Cy');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.onDisconnect('b');
  game.race.phase = 'results';
  expect(registry.byToken('b')).toBeDefined(); // still held through the results
  session.onMessage('a', { t: 'rematch' });
  expect(game.race.phase).toBe('countdown');
  expect(registry.byToken('b')).toBeUndefined();
  expect(registry.all().map((p) => p.token)).toEqual(['a', 'c']);
  expect(game.karts.map((k) => k.id)).toEqual([0, 1, 2]); // same grid; a bot fills the gap
  expect(session.driverFor(1)).toMatchObject({ kind: 'bot', name: 'Sky' });

  sent = [];
  expect(session.onHello('b', 'Bea')).toBeNull();
  expect(to('b')[0]).toEqual({ t: 'welcome', slot: 1, color: KART_COLORS[1] });
  expect(joins).toEqual(['a', 'b', 'c', 'b']); // a fresh join
  expect(session.driverFor(1)).toMatchObject({ kind: 'human', name: 'Bea' });
});

test('a phone joining during results gets a slot and its own kart in the rematch', () => {
  const { game, session } = setup(0);
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  game.race.phase = 'results';
  expect(game.karts).toHaveLength(1);
  expect(session.onHello('late', 'Lou')).toBeNull();
  expect(to('late')[0]).toEqual({ t: 'welcome', slot: 1, color: KART_COLORS[1] });
  session.onMessage('a', { t: 'rematch' });
  expect(game.karts.map((k) => k.id)).toEqual([0, 1]);
  expect(session.driverFor(1)).toMatchObject({ kind: 'human', name: 'Lou' });
  expect(lastState('late')).toMatchObject({ phase: 'countdown', racers: 2 });
  expect(lastState('late')?.position).toBeGreaterThan(0);
});

test('a phone joining during the countdown drives a kart now or, if its slot has none, in the next race', () => {
  const now = setup(2);
  now.session.onHello('a', 'Ada');
  now.session.onMessage('a', { t: 'start' });
  expect(now.game.karts).toHaveLength(3);
  now.session.onHello('c', 'Cy'); // slot 1 has a bot kart: Cy takes it over this race
  expect(now.session.driverFor(1)).toMatchObject({ kind: 'human', name: 'Cy' });

  const next = setup(0);
  next.session.onHello('a', 'Ada');
  next.session.onMessage('a', { t: 'start' });
  next.session.onHello('c', 'Cy'); // no kart in slot 1 this race
  expect(next.game.karts).toHaveLength(1);
  stepUntil(next.game, next.session, 'racing');
  next.game.race.phase = 'results';
  next.session.onMessage('a', { t: 'rematch' });
  expect(next.game.karts.map((k) => k.id)).toEqual([0, 1]);
  expect(next.session.driverFor(1)).toMatchObject({ kind: 'human', name: 'Cy' });
});

test('a full room during results makes space by dropping players who left', () => {
  const { game, registry, session } = setup(0);
  for (const t of ['a', 'b', 'c', 'd', 'e', 'f']) session.onHello(t, t.toUpperCase());
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.onDisconnect('d');
  expect(session.onHello('late', 'Lou')).toEqual({ t: 'lobbyFull' }); // mid-race: d's kart is still out there
  game.race.phase = 'results';
  expect(session.onHello('late', 'Lou')).toBeNull();
  expect(to('late')).toContainEqual({ t: 'welcome', slot: 3, color: KART_COLORS[3] });
  expect(registry.byToken('d')).toBeUndefined();
});

test('results: a phone that was not connected when the race ended gets position 0, not a bot\'s place', () => {
  const { game, session } = setup(3);
  session.onHello('a', 'Ada');
  session.onHello('b', 'Bea');
  session.onHello('d', 'Dee');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.onDisconnect('b'); // left mid-race: a bot drove her kart home
  // Everyone crosses the line in the same step, Bea's kart (bot-driven) first.
  const past = [10, 14, 6, 2, 2, 2];
  const lateral = [0, 0, 0, -4, 0, 4]; // spread out, so no kart bumps another back over the line
  game.karts.forEach((k, i) => {
    k.distance = 3 * track.length + past[i];
    k.pos = track.pointAt(past[i], lateral[i]);
    k.trackIndex = track.project(k.pos).index;
  });
  stepUntil(game, session, 'results', 5);
  expect(game.race.phase).toBe('results');

  session.onHello('late', 'Lou'); // slot 3: a bot raced that kart
  session.onHello('b', 'Bea'); // back after the race ended
  session.onDisconnect('d'); // connected at the end, then a blip
  session.onHello('d', 'Dee');
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ phase: 'results', position: 2 });
  expect(lastState('d')).toMatchObject({ phase: 'results', position: 3 });
  expect(lastState('late')).toMatchObject({ phase: 'results', position: 0 });
  expect(lastState('b')).toMatchObject({ phase: 'results', position: 0 });
  // The rematch is a new race: everyone gets their place again.
  session.onMessage('a', { t: 'rematch' });
  stepUntil(game, session, 'racing');
  session.syncPhones();
  expect(lastState('late')?.position).toBeGreaterThan(0);
  expect(lastState('b')?.position).toBeGreaterThan(0);
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
  for (const id of [1, 2, 3]) expect(game.karts[id].distance - start[id], `kart ${id}`).toBeGreaterThan(100);
  // Still driving: each bot is at speed within the next 3 s (a mine or rocket may have just spun it).
  const atSpeed = new Set<number>();
  for (let i = 0; i < 180 && atSpeed.size < 3; i++) {
    for (const id of [1, 2, 3]) if (game.karts[id].speed > 8) atSpeed.add(id);
    stepFor(game, session, 1);
  }
  expect([...atSpeed].sort((x, y) => x - y)).toEqual([1, 2, 3]);
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

test('racing state carries the held item, its icon and the rolling flag', () => {
  const { game, session } = setup(1);
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ item: null, itemIcon: null, rolling: false });
  game.karts[0].rolling = { left: 1, item: 'shield' };
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ item: null, itemIcon: null, rolling: true });
  game.karts[0].rolling = null;
  game.karts[0].item = 'shield';
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ item: 'shield', itemIcon: '🛡️', rolling: false });
  game.karts[0].item = 'boost';
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ item: 'boost', itemIcon: '⚡', rolling: false });
});

test('racing state carries the kart\'s drift charge level (0 in the lobby)', () => {
  const { game, session } = setup(1);
  session.onHello('a', 'Ada');
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ phase: 'lobby', drift: 0 });
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ drift: 0 });
  game.karts[0].drift = { active: true, charge: 0.7 };
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ drift: 1 });
  game.karts[0].drift = { active: true, charge: 1.4 };
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ drift: 2 });
  game.karts[0].drift = { active: false, charge: 0 };
  session.syncPhones();
  expect(lastState('a')).toMatchObject({ drift: 0 });
});

test('hits and finished rolls reach the phone driving that kart', () => {
  const { game, session } = setup(1);
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  const events = () => to('a').filter((m) => m.t === 'event');
  game.world.hitKart(game.karts[0]);
  game.world.hitKart(game.karts[1]); // the bot's kart: nobody to tell
  // Every hit kart id comes back too (the TV shakes its camera for human karts).
  expect(session.flushKartEvents()).toEqual([0, 1]);
  expect(events()).toEqual([{ t: 'event', kind: 'hit' }]);
  const k = game.karts[0];
  k.pos = { ...game.itemBoxes.boxes[0].pos };
  k.trackIndex = track.project(k.pos).index; // teleported: refresh the projection hint
  stepFor(game, session, 1);
  expect(k.rolling).not.toBeNull();
  stepFor(game, session, 61);
  session.flushKartEvents();
  expect(events()).toEqual([
    { t: 'event', kind: 'hit' },
    { t: 'event', kind: 'itemGot' },
  ]);
  expect(session.flushKartEvents()).toEqual([]);
  expect(events()).toHaveLength(2);
});

test('bots pick up and use items during a race', () => {
  const { game, session } = setup(6);
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  session.onDisconnect('a');
  const used: string[] = [];
  let got = 0;
  for (let i = 0; i < 60 * 60; i++) {
    game.step(1 / 60, (id) => session.driverFor(id));
    got += game.drainItemGot().length;
    used.push(...game.world.drainSfx());
  }
  expect(got).toBeGreaterThan(3);
  expect(used.filter((s) => s === 'boost' || s === 'shield_up').length).toBeGreaterThan(3);
});

test('a phone tap shorter than a step (item on, then off, before the step) still fires once', () => {
  const { game, session } = setup(1);
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  const k = game.karts[0];
  k.item = 'boost';
  session.onMessage('a', { t: 'input', steer: 0, gas: true, brake: false, item: true });
  session.onMessage('a', { t: 'input', steer: 0, gas: true, brake: false, item: false });
  stepFor(game, session, 1);
  // Rising edge seen: the boost fired and the button reads as pressed.
  expect(k.item).toBeNull();
  expect(game.world.hasEffect(k, 'boost')).toBe(true);
  expect(k.itemPressed).toBe(true);
  // The next step sees the real level again: released (the falling edge).
  stepFor(game, session, 1);
  expect(k.itemPressed).toBe(false);
  // The rest of the input is the latest message.
  expect(session.driverFor(0).input()).toEqual({ steer: 0, gas: true, brake: false, item: false });
});

test('a phone holding the item button reads as held across steps (one press only)', () => {
  const { game, session } = setup(1);
  session.onHello('a', 'Ada');
  session.onMessage('a', { t: 'start' });
  stepUntil(game, session, 'racing');
  const k = game.karts[0];
  k.item = 'boost';
  const held: ClientMsg = { t: 'input', steer: 0, gas: true, brake: false, item: true };
  session.onMessage('a', held);
  stepFor(game, session, 1);
  expect(k.item).toBeNull();
  k.item = 'shield';
  for (let i = 0; i < 10; i++) {
    session.onMessage('a', held);
    stepFor(game, session, 1);
    expect(k.itemPressed).toBe(true);
  }
  expect(k.item).toBe('shield'); // never a second rising edge while held
});

test('onJoin fires for a new phone only, not for a rejoin, a full lobby or the keyboard', () => {
  const joins: string[] = [];
  const game = new Game(track, mulberry32(7));
  const session = new Session(game, new PlayerRegistry(), send, {
    maxBots: 0,
    keyboard: { input: () => gasOnly },
    now: () => clock,
    rand: mulberry32(42),
    onJoin: (token) => joins.push(token),
  });
  expect(joins).toEqual([]); // the keyboard joining at boot is silent
  session.onHello('a', 'Ann');
  expect(joins).toEqual(['a']);
  session.onDisconnect('a');
  session.onHello('a', 'Ann');
  expect(joins).toEqual(['a']); // same phone coming back
  for (const t of ['b', 'c', 'd', 'e']) session.onHello(t, t);
  expect(joins).toHaveLength(5);
  // Slots 0-5 are taken: the keyboard and five phones.
  expect(session.onHello('f', 'Late')).toEqual({ t: 'lobbyFull' });
  session.onHello(KEYBOARD_TOKEN, 'Sneaky');
  expect(joins).toHaveLength(5);
});
