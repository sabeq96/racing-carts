import { describe, expect, test } from 'vitest';
import { KART_COLORS } from '@rc/shared';
import { createKart, type Kart } from '../kart/kart';
import { KART_RADIUS, SPIN_TIME } from '../kart/tuning';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { getPowerup } from './registry';
import type { BotContext, PowerupDef, PowerupEntity } from './types';
import { handleItemInput } from './useItem';
import { createWorld, type World } from './world';

const track = buildTrack(TRACK_V1);
const DT = 1 / 60;

const mkKarts = (n: number): Kart[] =>
  Array.from({ length: n }, (_, i) => createKart(i, KART_COLORS[i], track.grid[i], track));

/** Places a kart at track distance `s` and `lateral`, facing along the track (and keeps `distance` in step). */
function placeAt(k: Kart, s: number, lateral = 0): void {
  const p = track.pointAt(s, lateral);
  k.pos = { x: p.x, z: p.z };
  k.heading = track.headingAt(s);
  k.trackIndex = track.project(k.pos).index;
  k.distance = s;
}

/** Fires `id` from kart `k` through the real item button path. */
function fire(k: Kart, id: string, world: World): PowerupEntity {
  const before = world.entities.length;
  k.item = id;
  k.itemPressed = false;
  handleItemInput(k, true, world);
  expect(k.item).toBeNull();
  expect(world.entities.length).toBe(before + 1);
  return world.entities[world.entities.length - 1];
}

const ctx = (world: World, kart: Kart): BotContext => ({ kart, world, heldFor: 10 });
const mine = (): PowerupDef => getPowerup('mine') as PowerupDef;
const rocket = (): PowerupDef => getPowerup('rocket') as PowerupDef;

describe('mine', () => {
  test('mine drops 2.5 m behind and does not hit owner in first 0.5 s', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    const k = karts[0];
    placeAt(k, 20);
    k.heading = 0.3; // not the track heading: "behind" means behind the kart itself
    const m = fire(k, 'mine', world);
    expect(world.drainSfx()).toEqual(['mine_drop']);
    expect(m.pos.x).toBeCloseTo(k.pos.x - Math.sin(0.3) * 2.5, 9);
    expect(m.pos.z).toBeCloseTo(k.pos.z - Math.cos(0.3) * 2.5, 9);
    expect(m.look).toMatchObject({ shape: 'sphere', color: '#FF8A80', size: 0.9, y: 0.45 });
    expect(m.hitRadius).toBe(0.8);
    expect(m.targetId).toBeUndefined();

    // The owner sits right on it for 0.45 s: nothing happens.
    k.pos = { ...m.pos };
    for (let i = 0; i < 27; i++) world.step(DT);
    expect(k.spin).toBe(0);
    expect(world.entities).toEqual([m]);
    expect(world.drainHits()).toEqual([]);

    // Once the grace is over, the mine catches anyone, its owner included.
    k.pos = { x: m.pos.x + 10, z: m.pos.z };
    for (let i = 0; i < 6; i++) world.step(DT);
    k.pos = { ...m.pos };
    world.step(DT);
    expect(k.spin).toBe(SPIN_TIME);
    expect(world.entities).toEqual([]);
  });

  test('mine spins the first kart that touches it, then disappears', () => {
    const karts = mkKarts(3);
    const world = createWorld(karts, track);
    const [owner, a, b] = karts;
    placeAt(owner, 40);
    placeAt(a, 10, -4);
    placeAt(b, 10, 4);
    const m = fire(owner, 'mine', world);
    world.drainSfx();
    world.step(DT);
    expect(world.entities).toEqual([m]);

    // Just out of reach: hitRadius 0.8 + KART_RADIUS.
    a.pos = { x: m.pos.x + 0.8 + KART_RADIUS + 0.01, z: m.pos.z };
    world.step(DT);
    expect(a.spin).toBe(0);
    a.pos = { x: m.pos.x + 0.8 + KART_RADIUS - 0.01, z: m.pos.z };
    a.speed = 15;
    world.step(DT);
    expect(a.spin).toBe(SPIN_TIME);
    expect(a.speed).toBeCloseTo(3);
    expect(world.drainHits()).toEqual([a.id]);
    expect(world.drainSfx()).toEqual(['kart_spinout', 'mine_explode']);
    expect(world.entities).toEqual([]);

    // It is gone: the next kart drives over the same spot unharmed.
    b.pos = { ...m.pos };
    world.step(DT);
    expect(b.spin).toBe(0);
  });

  test('mine blocked by a shield: no spin, shield gone, mine gone', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    placeAt(karts[0], 40);
    const m = fire(karts[0], 'mine', world);
    world.applyEffect(karts[1], 'shield', 6);
    karts[1].pos = { ...m.pos };
    world.step(DT);
    expect(karts[1].spin).toBe(0);
    expect(world.hasEffect(karts[1], 'shield')).toBe(false);
    expect(world.entities).toEqual([]);
  });

  test('mine expires after 30 s', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    placeAt(karts[0], 40);
    const m = fire(karts[0], 'mine', world);
    karts[0].pos = { x: 999, z: 999 };
    for (let i = 0; i < 1799; i++) world.step(DT);
    expect(world.entities).toEqual([m]);
    world.step(DT);
    expect(world.entities).toEqual([]);
  });
});

describe('rocket', () => {
  /** Steps the world until the rocket is gone (or `maxSteps`); returns the steps taken and the largest |lateral| seen. */
  function flyOut(world: World, r: PowerupEntity, maxSteps: number): { steps: number; maxLateral: number } {
    let maxLateral = 0;
    for (let i = 1; i <= maxSteps; i++) {
      world.step(DT);
      if (world.entities.indexOf(r) < 0) return { steps: i, maxLateral };
      maxLateral = Math.max(maxLateral, Math.abs(track.project(r.pos).lateral));
    }
    return { steps: Infinity, maxLateral };
  }

  test('rocket hits the kart 30 m ahead within 2 s', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const [shooter, target] = karts;
    placeAt(shooter, 10, -3);
    placeAt(target, 40, 3);
    target.speed = 15;
    const r = fire(shooter, 'rocket', world);
    expect(world.drainSfx()).toEqual(['rocket_fire']);
    expect(r.targetId).toBe(target.id);
    expect(r.look).toMatchObject({ shape: 'cone', color: '#82B1FF', size: 1, y: 0.8 });
    expect(r.hitRadius).toBe(1);
    // It starts 2 m ahead of the shooter on the track, at the shooter's lateral.
    const start = track.pointAt(12, -3);
    expect(Math.hypot(r.pos.x - start.x, r.pos.z - start.z)).toBeLessThan(0.3);

    const { steps } = flyOut(world, r, 120);
    expect(steps).toBeLessThanOrEqual(120);
    // ~28 m at 40 m/s.
    expect(steps).toBeGreaterThan(36);
    expect(target.spin).toBe(SPIN_TIME);
    expect(shooter.spin).toBe(0);
    expect(world.drainHits()).toEqual([target.id]);
    expect(world.drainSfx()).toEqual(['kart_spinout', 'rocket_explode']);
  });

  test('rocket follows the track round a bend to its target', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const [shooter, target] = karts;
    // The top loop: 50 m of bend between them.
    placeAt(shooter, 60, 2);
    placeAt(target, 110, -4);
    const r = fire(shooter, 'rocket', world);
    let headingOk = true;
    let prev = { ...r.pos };
    let maxLateral = 0;
    let steps = 0;
    for (; steps < 180 && world.entities.indexOf(r) >= 0; steps++) {
      world.step(DT);
      const dx = r.pos.x - prev.x, dz = r.pos.z - prev.z;
      // It faces where it flies, so render can point its nose that way.
      if (Math.hypot(dx, dz) > 0.1) {
        const moved = Math.atan2(dx, dz);
        const diff = Math.abs(Math.atan2(Math.sin(moved - r.heading), Math.cos(moved - r.heading)));
        if (diff > 0.2) headingOk = false;
      }
      prev = { ...r.pos };
      maxLateral = Math.max(maxLateral, Math.abs(track.project(r.pos).lateral));
    }
    expect(steps).toBeLessThan(120);
    expect(target.spin).toBe(SPIN_TIME);
    expect(maxLateral).toBeLessThan(track.width / 2);
    expect(headingOk).toBe(true);
  });

  test('rocket blocked by target shield: target not spun, shield gone', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const [shooter, target] = karts;
    placeAt(shooter, 10);
    placeAt(target, 40);
    world.applyEffect(target, 'shield', 6);
    const r = fire(shooter, 'rocket', world);
    world.drainSfx();
    const { steps } = flyOut(world, r, 120);
    expect(steps).toBeLessThanOrEqual(120);
    expect(target.spin).toBe(0);
    expect(world.hasEffect(target, 'shield')).toBe(false);
    expect(world.drainHits()).toEqual([]);
    expect(world.drainSfx()).toEqual(['shield_break', 'rocket_explode']);
  });

  test('rocket never hits its owner', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const [shooter, target] = karts;
    placeAt(shooter, 10);
    placeAt(target, 50);
    const r = fire(shooter, 'rocket', world);
    for (let i = 0; i < 10; i++) {
      shooter.pos = { ...r.pos };
      world.step(DT);
    }
    expect(shooter.spin).toBe(0);
    expect(world.entities).toEqual([r]);
  });

  test('rocket with nobody ahead dies within 3 s', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const [leader, other] = karts;
    placeAt(leader, 20);
    placeAt(other, 0);
    const r = fire(leader, 'rocket', world);
    expect(r.targetId).toBeUndefined();
    world.drainSfx();
    const h = leader.heading;
    world.step(DT);
    // Straight along the shooter's heading.
    const moved = Math.atan2(r.pos.x - leader.pos.x, r.pos.z - leader.pos.z);
    expect(Math.abs(moved - h)).toBeLessThan(0.02);
    expect(r.heading).toBeCloseTo(h, 9);
    const { steps } = flyOut(world, r, 181);
    expect(steps).toBeLessThanOrEqual(180);
    expect(other.spin).toBe(0);
  });

  test('rocket with nobody ahead pops at the wall', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    const k = karts[0];
    placeAt(k, 20);
    k.heading += Math.PI / 2; // facing the right-hand wall, 6 m away
    const r = fire(k, 'rocket', world);
    world.drainSfx();
    const { steps } = flyOut(world, r, 180);
    // 6 m at 40 m/s is ~9 steps (it starts 2 m out).
    expect(steps).toBeLessThan(20);
    expect(world.drainSfx()).toEqual(['rocket_explode']);
  });

  test('rocket chasing a kart it cannot catch gives up after 6 s', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const [shooter, target] = karts;
    placeAt(shooter, 10);
    placeAt(target, 40);
    const r = fire(shooter, 'rocket', world);
    let steps = 0;
    for (; steps < 400 && world.entities.indexOf(r) >= 0; steps++) {
      // The target keeps teleporting 30 m ahead of the rocket.
      const s = track.project(r.pos).s;
      placeAt(target, s + 30);
      target.distance = 40 + steps; // still ahead in the race order
      world.step(DT);
    }
    expect(steps).toBeGreaterThan(350);
    expect(steps).toBeLessThanOrEqual(361);
    expect(target.spin).toBe(0);
  });
});

describe('weights and bots', () => {
  test('mine and rocket weights follow the brief', () => {
    expect(mine().weight({ position: 1, racerCount: 6 })).toBe(3);
    expect(mine().weight({ position: 6, racerCount: 6 })).toBe(1);
    expect(rocket().weight({ position: 1, racerCount: 6 })).toBe(0.5);
    expect(rocket().weight({ position: 6, racerCount: 6 })).toBe(3.5);
    expect(mine().icon).toBeTruthy();
    expect(rocket().icon).toBeTruthy();
  });

  test('bot uses rocket only with a kart ahead within 60 m; mine only with one behind within 15 m', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const [me, other] = karts;
    placeAt(me, 100);

    placeAt(other, 150); // 50 m ahead
    expect(rocket().botShouldUse?.(ctx(world, me))).toBe(true);
    expect(mine().botShouldUse?.(ctx(world, me))).toBe(false);
    placeAt(other, 165); // 65 m ahead
    expect(rocket().botShouldUse?.(ctx(world, me))).toBe(false);

    placeAt(other, 90); // 10 m behind
    expect(rocket().botShouldUse?.(ctx(world, me))).toBe(false);
    expect(mine().botShouldUse?.(ctx(world, me))).toBe(true);
    placeAt(other, 80); // 20 m behind
    expect(mine().botShouldUse?.(ctx(world, me))).toBe(false);
  });
});
