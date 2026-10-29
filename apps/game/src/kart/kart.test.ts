import { describe, expect, test } from 'vitest';
import { NEUTRAL_INPUT, type InputSnapshot } from '@rc/shared';
import { buildTrack } from '../track/track';
import { dist } from '../math/vec2';
import { createKart, resolveKartCollisions, stepKart, type Kart } from './kart';
import { KART_RADIUS, MAX_SPEED, REVERSE_MAX } from './tuning';

// Long rounded rectangle, ~400 (z) x 80 (x), width 12. Start line at (0, -100) heading +z.
const R = 40;
const arc = (cx: number, cz: number, from: number, to: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = from + ((to - from) * (i + 1)) / (n + 1);
    return [cx + R * Math.cos(a), cz + R * Math.sin(a)] as [number, number];
  });
const track = buildTrack({
  controlPoints: [
    [0, -100], [0, 0], [0, 100], [0, 160],
    ...arc(40, 160, Math.PI, 0, 3),
    [80, 160], [80, 80], [80, 0], [80, -80], [80, -160],
    ...arc(40, -160, 0, -Math.PI, 3),
    [0, -160],
  ],
  width: 12,
  itemBoxRows: [],
  itemBoxLaterals: [],
});

const DT = 1 / 60;
const gas: InputSnapshot = { ...NEUTRAL_INPUT, gas: true };
const brake: InputSnapshot = { ...NEUTRAL_INPUT, brake: true };

function run(k: Kart, input: InputSnapshot, seconds: number, onStep?: (hit: boolean) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const { hitWall } = stepKart(k, input, track, DT);
    onStep?.(hitWall);
  }
}

const freshKart = () => createKart(0, '#FF8A80', track.grid[0], track);

describe('kart physics', () => {
  test('full gas reaches but never exceeds MAX_SPEED', () => {
    const k = freshKart();
    let maxSeen = 0;
    const n = Math.round(5 / DT);
    for (let i = 0; i < n; i++) {
      stepKart(k, gas, track, DT);
      maxSeen = Math.max(maxSeen, k.speed);
    }
    expect(maxSeen).toBeLessThanOrEqual(20.01);
    expect(MAX_SPEED).toBe(20);
    expect(k.speed).toBeGreaterThanOrEqual(19.5);
  });

  test('boost effect raises top speed to 32', () => {
    const k = freshKart();
    k.effects = [{ kind: 'boost', remaining: 99 }];
    run(k, gas, 5);
    expect(k.speed).toBeGreaterThan(30);
    expect(k.speed).toBeLessThanOrEqual(32.01);
  });

  test('coasting slows down; brake from rest reverses to ≥ −6', () => {
    const k = freshKart();
    k.speed = 10;
    k.vel = { x: 0, z: 10 };
    run(k, NEUTRAL_INPUT, 1);
    expect(k.speed).toBeLessThan(10);
    expect(k.speed).toBeGreaterThan(0);

    const r = freshKart();
    let minSeen = 0;
    const n = Math.round(4 / DT);
    for (let i = 0; i < n; i++) {
      stepKart(r, brake, track, DT);
      minSeen = Math.min(minSeen, r.speed);
    }
    expect(r.speed).toBeLessThan(-5);
    expect(minSeen).toBeGreaterThanOrEqual(-REVERSE_MAX - 1e-6);
  });

  test('brake works above top speed too (e.g. just after a boost ends)', () => {
    const k = freshKart();
    k.speed = 30;
    k.vel = { x: 0, z: 30 };
    run(k, brake, 0.25);
    // Hard braking (24 m/s²), not the gentle over-max ease-off (12 m/s²).
    expect(k.speed).toBeLessThan(25);
  });

  test('steer > 0 increases heading (turns right)', () => {
    const k = freshKart();
    k.speed = 10;
    k.vel = { x: 0, z: 10 };
    const h0 = k.heading;
    run(k, { ...gas, steer: 1 }, 0.5);
    expect(k.heading).toBeGreaterThan(h0);
  });

  test('wall contact keeps kart inside and reports hitWall', () => {
    const k = freshKart();
    const s = 50;
    k.pos = track.pointAt(s, 5.5);
    k.heading = track.headingAt(s) + Math.PI / 2; // straight across, towards the right wall
    k.speed = 15;
    k.vel = { x: Math.sin(k.heading) * 15, z: Math.cos(k.heading) * 15 };
    k.trackIndex = track.project(k.pos).index;
    let hits = 0;
    let worst = 0;
    run(k, gas, 1, (hit) => {
      if (hit) hits++;
      worst = Math.max(worst, Math.abs(track.project(k.pos, k.trackIndex).lateral));
    });
    expect(hits).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(6 - KART_RADIUS + 1e-6);
  });

  test('steer > 0 while reversing decreases heading', () => {
    const k = freshKart();
    k.speed = -4;
    k.vel = { x: 0, z: -4 };
    const h0 = k.heading;
    stepKart(k, { ...brake, steer: 1 }, track, DT);
    expect(k.heading).toBeLessThan(h0);
  });

  test('createKart seeds trackIndex from the track projection', () => {
    const k = freshKart();
    expect(k.trackIndex).toBe(track.project(track.grid[0].pos).index);
  });

  /** A kart on the right wall at 15 m/s, re-aimed ~3° into it every step (a player leaning on the wall). */
  function graze(seconds: number): { kart: Kart; contacts: number; steps: number } {
    const k = freshKart();
    const s = 50;
    const into = (3 * Math.PI) / 180;
    k.pos = track.pointAt(s, 5);
    k.heading = track.headingAt(s) + into;
    k.speed = 15;
    k.vel = { x: Math.sin(k.heading) * 15, z: Math.cos(k.heading) * 15 };
    k.trackIndex = track.project(k.pos).index;
    const steps = Math.round(seconds / DT);
    let contacts = 0;
    for (let i = 0; i < steps; i++) {
      stepKart(k, gas, track, DT);
      const pr = track.project(k.pos, k.trackIndex);
      if (Math.abs(pr.lateral) >= 6 - KART_RADIUS - 0.1) contacts++; // within 10 cm: on the wall
      k.heading = track.headingAt(pr.s) + into;
    }
    return { kart: k, contacts, steps };
  }

  test('brief graze (0.2 s along the wall) loses < 30% of its speed', () => {
    const { kart, contacts, steps } = graze(0.2);
    expect(contacts).toBe(steps); // touching the wall the whole time
    expect(kart.speed).toBeGreaterThan(15 * 0.7);
    expect(kart.speed).toBeLessThan(15); // but the scrape does cost something, even with gas held
  });

  test('riding a wall with gas held settles near half top speed (no guide rails)', () => {
    const { kart, contacts, steps } = graze(2);
    expect(contacts).toBe(steps);
    expect(kart.speed).toBeLessThan(MAX_SPEED * 0.55);
  });

  test('perpendicular wall hit at 15 m/s loses about 20% and reports hitWall', () => {
    const k = freshKart();
    const s = 50;
    k.pos = track.pointAt(s, 4.9);
    k.heading = track.headingAt(s) + Math.PI / 2;
    k.speed = 15;
    k.vel = { x: Math.sin(k.heading) * 15, z: Math.cos(k.heading) * 15 };
    k.trackIndex = track.project(k.pos).index;
    let hit = false;
    for (let i = 0; i < 10 && !hit; i++) hit = stepKart(k, NEUTRAL_INPUT, track, DT).hitWall;
    expect(hit).toBe(true);
    expect(k.speed).toBeLessThanOrEqual(12.1);
    expect(k.speed).toBeGreaterThan(11);
  });

  test('spin ignores gas', () => {
    const k = freshKart();
    k.spin = 1.2;
    k.speed = 5;
    k.vel = { x: 0, z: 5 };
    run(k, gas, 0.5);
    expect(k.speed).toBeLessThan(5);
    expect(k.spin).toBeLessThan(1.2);
  });

  test('overlapping karts get separated', () => {
    const a = freshKart();
    const b = createKart(1, '#82B1FF', track.grid[1], track);
    a.pos = { x: 0, z: 0 };
    b.pos = { x: 1, z: 0 };
    const pairs = resolveKartCollisions([a, b]);
    expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(pairs).toEqual([[0, 1]]);
  });
});
