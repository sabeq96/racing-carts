import { expect, test } from 'vitest';
import { KART_COLORS, NEUTRAL_INPUT } from '@rc/shared';
import { buildTrack } from './track/track';
import { TRACK_V1 } from './track/trackDef';
import { Game, type Driver } from './game';
import { MAX_SPEED } from './kart/tuning';
import { mulberry32 } from './test/rand';

const track = buildTrack(TRACK_V1);
const gas = { steer: 0, gas: true, brake: false, item: false };
const drivers = (humans: number[]) => (id: number): Driver =>
  humans.includes(id)
    ? { kind: 'human', name: 'P' + id, input: () => gas }
    : { kind: 'bot', name: 'Bot', input: () => NEUTRAL_INPUT };

test('setupKarts places karts on grid slots with slot colours', () => {
  const g = new Game(track);
  g.setupKarts(4);
  expect(g.karts.map((k) => k.id)).toEqual([0, 1, 2, 3]);
  expect(g.karts.map((k) => k.color)).toEqual(KART_COLORS.slice(0, 4));
  expect(g.karts[2].pos).toEqual(track.grid[2].pos);
  g.setupKarts(9);
  expect(g.karts).toHaveLength(6);
});

test('karts ignore input until racing, then the human kart drives', () => {
  const g = new Game(track);
  g.setupKarts(2);
  const d = drivers([0]);
  for (let i = 0; i < 30; i++) g.step(1 / 60, d);
  expect(g.karts[0].speed).toBe(0);
  g.race.start();
  const events = [];
  for (let i = 0; i < 400 && g.race.phase !== 'racing'; i++) events.push(...g.step(1 / 60, d));
  expect(events.map((e) => e.kind)).toEqual(['countdown', 'countdown', 'countdown', 'go']);
  expect(g.karts[0].speed).toBe(0);
  for (let i = 0; i < 60; i++) g.step(1 / 60, d);
  expect(g.karts[0].speed).toBeGreaterThan(5);
  expect(g.karts[1].speed).toBe(0);
  expect(g.karts[0].distance).toBeGreaterThan(g.karts[1].distance);
});

test('humanKartIds reflects the drivers of the latest step', () => {
  const g = new Game(track);
  g.setupKarts(3);
  expect(g.humanKartIds()).toEqual([]);
  g.step(1 / 60, drivers([0, 2]));
  expect(g.humanKartIds()).toEqual([0, 2]);
});

const press = (item: boolean) => ({ steer: 0, gas: true, brake: false, item });
const human = (input: () => { steer: number; gas: boolean; brake: boolean; item: boolean }) => (): Driver => ({
  kind: 'human',
  name: 'P',
  input,
});

function toRacing(g: Game, d: (id: number) => Driver): void {
  g.race.start();
  for (let i = 0; i < 400 && g.race.phase !== 'racing'; i++) g.step(1 / 60, d);
}

test('a kart in an item box rolls for 1 s, gets the item and is reported once', () => {
  const g = new Game(track, mulberry32(4));
  g.setupKarts(2);
  const d = human(() => NEUTRAL_INPUT);
  toRacing(g, d);
  const k = g.karts[1];
  k.pos = { ...g.itemBoxes.boxes[0].pos };
  k.trackIndex = track.project(k.pos).index; // teleported: refresh the projection hint
  g.step(1 / 60, d);
  expect(k.rolling).not.toBeNull();
  expect(g.itemBoxes.boxes[0].respawn).toBeGreaterThan(0);
  expect(g.drainItemGot()).toEqual([]);
  for (let i = 0; i < 60; i++) g.step(1 / 60, d);
  expect(k.rolling).toBeNull();
  expect(k.item).not.toBeNull();
  expect(g.drainItemGot()).toEqual([1]);
  expect(g.drainItemGot()).toEqual([]);
});

test('item input applies only while racing, on the rising edge, before physics in the same step', () => {
  const g = new Game(track);
  g.setupKarts(1);
  let held = true;
  const d = human(() => press(held));
  const k = g.karts[0];
  k.item = 'boost';
  g.race.start();
  g.step(1 / 60, d); // countdown: the press is ignored
  expect(k.item).toBe('boost');
  for (let i = 0; i < 400 && g.race.phase !== 'racing'; i++) g.step(1 / 60, d);
  // Held through GO: the first racing step is a fresh press.
  k.speed = MAX_SPEED;
  g.step(1 / 60, d);
  expect(k.item).toBeNull();
  expect(g.world.hasEffect(k, 'boost')).toBe(true);
  // The boost already raised the cap in that same step.
  expect(k.speed).toBeGreaterThan(MAX_SPEED);
  k.item = 'shield';
  g.step(1 / 60, d); // still held
  expect(k.item).toBe('shield');
  held = false;
  g.step(1 / 60, d);
  held = true;
  g.step(1 / 60, d);
  expect(k.item).toBeNull();
  expect(g.world.hasEffect(k, 'shield')).toBe(true);
});

test('setupKarts resets the world, the item boxes and every kart item state', () => {
  const g = new Game(track);
  g.setupKarts(2);
  const d = human(() => NEUTRAL_INPUT);
  toRacing(g, d);
  g.karts[0].item = 'shield';
  g.karts[1].rolling = { left: 0.5, item: 'boost' };
  g.world.applyEffect(g.karts[0], 'boost', 1);
  g.world.spawnEntity({ pos: { x: 0, z: 0 }, heading: 0, look: { shape: 'box', color: '#fff', size: 1 }, hitRadius: 1, dead: false, update() {} });
  g.world.hitKart(g.karts[1]);
  g.itemBoxes.boxes[2].respawn = 2;
  g.setupKarts(2);
  expect(g.world.entities).toEqual([]);
  expect(g.world.drainHits()).toEqual([]);
  expect(g.world.karts).toBe(g.karts);
  expect(g.itemBoxes.boxes.every((b) => b.respawn === 0)).toBe(true);
  for (const k of g.karts) {
    expect(k.item).toBeNull();
    expect(k.rolling).toBeNull();
    expect(k.effects).toEqual([]);
    expect(k.itemPressed).toBe(false);
  }
});

test('effects tick down in the game step', () => {
  const g = new Game(track);
  g.setupKarts(1);
  g.world.applyEffect(g.karts[0], 'shield', 0.5);
  const d = human(() => NEUTRAL_INPUT);
  for (let i = 0; i < 30; i++) g.step(1 / 60, d);
  expect(g.world.hasEffect(g.karts[0], 'shield')).toBe(false);
});

test('wall hits and kart bumps are reported once per drain, per kart id', () => {
  const g = new Game(track);
  g.setupKarts(2);
  g.race.start();
  const d = drivers([0]);
  while (g.race.phase !== 'racing') g.step(1 / 60, d);
  expect(g.drainWallHits()).toEqual([]);
  expect(g.drainKartBumps()).toEqual([]);

  // Kart 0 hurtles at the left wall.
  const k = g.karts[0];
  const s = 50;
  k.pos = track.pointAt(s, 4.9);
  k.heading = track.headingAt(s) + Math.PI / 2;
  k.speed = 15;
  k.vel = { x: Math.sin(k.heading) * 15, z: Math.cos(k.heading) * 15 };
  k.trackIndex = track.project(k.pos).index;
  // Kart 1 waits far away from the wall.
  g.karts[1].pos = track.pointAt(200, 0);
  g.karts[1].trackIndex = track.project(g.karts[1].pos).index;
  for (let i = 0; i < 10; i++) g.step(1 / 60, d);
  expect(g.drainWallHits()).toContain(0);
  expect(g.drainWallHits()).toEqual([]); // drained

  // Park both karts mid-road, one metre apart (the collision radius is 2 m for a pair).
  for (const [i, lateral] of [[0, -0.5], [1, 0.5]] as const) {
    const kart = g.karts[i];
    kart.pos = track.pointAt(300, lateral);
    kart.trackIndex = track.project(kart.pos).index;
    kart.speed = 0;
    kart.vel = { x: 0, z: 0 };
  }
  g.drainWallHits();
  g.step(1 / 60, d);
  const bumped = [...g.drainKartBumps()].sort();
  expect(bumped).toEqual([0, 1]);
  expect(g.drainKartBumps()).toEqual([]);
});

test('setupKarts forgets undelivered wall hits and bumps', () => {
  const g = new Game(track);
  g.setupKarts(2);
  g.karts[1].pos = { x: g.karts[0].pos.x + 0.2, z: g.karts[0].pos.z };
  g.step(1 / 60, drivers([]));
  g.setupKarts(2);
  expect(g.drainKartBumps()).toEqual([]);
});

test('a kart driving over a boost pad in a race step gets the boost and its sound', () => {
  const g = new Game(track);
  g.setupKarts(1);
  const d = human(() => NEUTRAL_INPUT);
  toRacing(g, d);
  g.world.drainSfx();
  const pad = track.boostPads[0];
  const k = g.karts[0];
  k.pos = { x: pad.pos.x, z: pad.pos.z };
  k.heading = pad.heading;
  k.trackIndex = track.project(k.pos).index;
  g.step(1 / 60, d);
  expect(g.world.hasEffect(k, 'boost')).toBe(true);
  expect(g.world.drainSfx()).toContain('boost');
});

test('a kart tucked in behind another during the race builds up draft in the game step', () => {
  const g = new Game(track);
  g.setupKarts(2);
  const d = human(() => gas);
  toRacing(g, d);
  const [a, b] = g.karts;
  for (const [k, s] of [[a, 100], [b, 106]] as const) {
    k.pos = track.pointAt(s, 0);
    k.heading = track.headingAt(s);
    k.trackIndex = track.project(k.pos).index;
    k.distance = s;
    k.speed = 15;
    k.vel = { x: Math.sin(k.heading) * 15, z: Math.cos(k.heading) * 15 };
  }
  for (let i = 0; i < 10; i++) g.step(1 / 60, d);
  expect(a.draft).toBeGreaterThan(0.1);
  expect(b.draft).toBe(0);
});
