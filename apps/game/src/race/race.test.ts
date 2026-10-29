import { describe, expect, test } from 'vitest';
import { TOTAL_LAPS } from '@rc/shared';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { createKart, type Kart } from '../kart/kart';
import { Race, type RaceEvent } from './race';

const track = buildTrack(TRACK_V1);
const L = track.length;
const humans = new Set<number>();
const isHuman = (id: number) => humans.has(id);

function makeKarts(n: number, human: number[]): Kart[] {
  humans.clear();
  human.forEach((id) => humans.add(id));
  return Array.from({ length: n }, (_, i) => createKart(i, '#fff', track.grid[i], track));
}

/** Runs the countdown and returns the events seen. */
function goRacing(race: Race, karts: Kart[]): RaceEvent[] {
  race.start();
  const ev: RaceEvent[] = [];
  for (let i = 0; i < 400 && race.phase === 'countdown'; i++) ev.push(...race.update(1 / 60, karts, track, isHuman));
  return ev;
}

/** Teleports kart to unwrapped distance `d` in <=2 m steps, running the race update each step. */
function drive(race: Race, karts: Kart[], k: Kart, d: number, dt = 0.01): RaceEvent[] {
  const ev: RaceEvent[] = [];
  while (k.distance < d - 1e-6 && race.phase === 'racing' && k.finishedAt === null) {
    const next = Math.min(d, k.distance + 2);
    k.pos = track.pointAt(next);
    ev.push(...race.update(dt, karts, track, isHuman));
  }
  return ev;
}

describe('Race', () => {
  test('countdown emits 3,2,1,go then racing', () => {
    const karts = makeKarts(2, [0]);
    const race = new Race();
    expect(race.phase).toBe('lobby');
    race.start();
    expect(race.phase).toBe('countdown');
    const ev: RaceEvent[] = [];
    let t = 0;
    while (race.phase === 'countdown' && t < 10) {
      ev.push(...race.update(1 / 60, karts, track, isHuman));
      t += 1 / 60;
    }
    expect(ev).toEqual([
      { kind: 'countdown', n: 3 },
      { kind: 'countdown', n: 2 },
      { kind: 'countdown', n: 1 },
      { kind: 'go' },
    ]);
    expect(race.phase).toBe('racing');
    expect(t).toBeGreaterThan(2.9);
    expect(t).toBeLessThan(3.1);
    expect(race.time).toBe(0);
  });

  test('countdown does not move distance', () => {
    const karts = makeKarts(2, [0]);
    const race = new Race();
    race.start();
    const before = karts.map((k) => k.distance);
    karts[0].pos = track.pointAt(50);
    race.update(0.5, karts, track, isHuman);
    expect(karts.map((k) => k.distance)).toEqual(before);
  });

  test('a single large dt emits events in order without skipping', () => {
    const karts = makeKarts(1, [0]);
    const race = new Race();
    race.start();
    const ev = race.update(3.5, karts, track, isHuman);
    expect(ev.map((e) => (e.kind === 'countdown' ? e.n : e.kind))).toEqual([3, 2, 1, 'go']);
    expect(race.phase).toBe('racing');
  });

  test('start is ignored while racing', () => {
    const karts = makeKarts(1, [0]);
    const race = new Race();
    goRacing(race, karts);
    race.start();
    expect(race.phase).toBe('racing');
  });

  test('results when all humans finished (bots still racing)', () => {
    const karts = makeKarts(3, [0, 1]);
    const race = new Race();
    goRacing(race, karts);
    const total = L * TOTAL_LAPS;
    const e0 = drive(race, karts, karts[0], total);
    expect(e0).toContainEqual({ kind: 'finish', kartId: 0, place: 1 });
    expect(race.phase).toBe('racing');
    const e1 = drive(race, karts, karts[1], total);
    expect(e1).toContainEqual({ kind: 'finish', kartId: 1, place: 2 });
    expect(e1[e1.length - 1]).toEqual({ kind: 'results' });
    expect(race.phase).toBe('results');
    expect(karts[2].finishedAt).toBeNull();
    expect(karts[0].finishedAt).not.toBeNull();
    // Further updates are inert.
    expect(race.update(1, karts, track, isHuman)).toEqual([]);
  });

  test('results 30 s after first human finish even if others still racing', () => {
    const karts = makeKarts(3, [0, 1]);
    const race = new Race();
    goRacing(race, karts);
    drive(race, karts, karts[0], L * TOTAL_LAPS);
    const tFinish = karts[0].finishedAt!;
    expect(tFinish).not.toBeNull();
    const ev: RaceEvent[] = [];
    while (race.phase === 'racing') ev.push(...race.update(0.5, karts, track, isHuman));
    expect(race.time - tFinish).toBeGreaterThanOrEqual(30);
    expect(race.time - tFinish).toBeLessThan(30.6);
    expect(ev.filter((e) => e.kind === 'results')).toHaveLength(1);
    expect(karts[1].finishedAt).toBeNull();
  });

  test('bot finishing first does not start the 30 s clock', () => {
    const karts = makeKarts(2, [0]);
    const race = new Race();
    goRacing(race, karts);
    drive(race, karts, karts[1], L * TOTAL_LAPS);
    expect(karts[1].finishedAt).not.toBeNull();
    for (let i = 0; i < 100; i++) race.update(1, karts, track, isHuman);
    expect(race.phase).toBe('racing');
  });

  test('no humans: results when all karts finished', () => {
    const karts = makeKarts(2, []);
    const race = new Race();
    goRacing(race, karts);
    drive(race, karts, karts[0], L * TOTAL_LAPS);
    expect(race.phase).toBe('racing');
    drive(race, karts, karts[1], L * TOTAL_LAPS);
    expect(race.phase).toBe('results');
  });

  test('lap and finalLap events', () => {
    const karts = makeKarts(1, [0]);
    const race = new Race();
    goRacing(race, karts);
    const ev = drive(race, karts, karts[0], L * TOTAL_LAPS);
    expect(ev.filter((e) => e.kind !== 'results')).toEqual([
      { kind: 'lap', kartId: 0, lap: 2 },
      { kind: 'lap', kartId: 0, lap: 3 },
      { kind: 'finalLap', kartId: 0 },
      { kind: 'finish', kartId: 0, place: 1 },
    ]);
  });

  test('crossing the line backwards on the grid does not emit lap events', () => {
    const karts = makeKarts(1, [0]);
    const race = new Race();
    goRacing(race, karts);
    const ev: RaceEvent[] = [];
    for (const s of [-4, -2, 0, 2, 4, 2, 0, -2, -4]) {
      karts[0].pos = track.pointAt(s);
      ev.push(...race.update(0.1, karts, track, isHuman));
    }
    expect(ev).toEqual([]);
  });

  test('karts finishing in the same step are placed by distance, whatever the array order', () => {
    for (const order of [[0, 1], [1, 0]]) {
      const karts = makeKarts(2, [0, 1]);
      const race = new Race();
      goRacing(race, karts);
      const total = L * TOTAL_LAPS;
      for (const k of karts) k.distance = total - 3;
      // Both cross the line in one step; kart 0 ends up 1 m further past it than kart 1.
      karts[0].pos = track.pointAt(total + 1);
      karts[1].pos = track.pointAt(total);
      const ev = race.update(0.01, order.map((i) => karts[i]), track, isHuman);
      const finishes = ev.filter((e) => e.kind === 'finish');
      expect(finishes).toEqual([
        { kind: 'finish', kartId: 0, place: 1 },
        { kind: 'finish', kartId: 1, place: 2 },
      ]);
      expect(karts[0].finishedAt).toBe(karts[1].finishedAt);
    }
  });

  test('dithering across the line into lap 3 emits finalLap exactly once', () => {
    const karts = makeKarts(1, [0]);
    const race = new Race();
    goRacing(race, karts);
    const ev: RaceEvent[] = [];
    ev.push(...drive(race, karts, karts[0], L * 2 - 4));
    for (let i = 0; i < 6; i++) {
      for (const d of [L * 2 + 4, L * 2 - 4]) {
        const target = d;
        while (Math.abs(karts[0].distance - target) > 1e-6) {
          const step = Math.sign(target - karts[0].distance) * Math.min(2, Math.abs(target - karts[0].distance));
          karts[0].pos = track.pointAt(karts[0].distance + step);
          ev.push(...race.update(0.01, karts, track, isHuman));
        }
      }
    }
    expect(ev.filter((e) => e.kind === 'finalLap')).toHaveLength(1);
    expect(ev.filter((e) => e.kind === 'lap' && e.lap === 3)).toHaveLength(1);
    expect(ev.filter((e) => e.kind === 'lap' && e.lap === 2)).toHaveLength(1);
  });

  test('backToLobby then start resets the race', () => {
    const karts = makeKarts(1, [0]);
    const race = new Race();
    goRacing(race, karts);
    drive(race, karts, karts[0], L * TOTAL_LAPS);
    expect(race.phase).toBe('results');
    race.backToLobby();
    expect(race.phase).toBe('lobby');
    race.start();
    expect(race.phase).toBe('countdown');
    expect(race.time).toBe(0);
  });

  test('a second race after results starts clean: place 1 to first finisher, old cutoff clock gone', () => {
    const karts = makeKarts(2, [0, 1]);
    const race = new Race();
    const total = L * TOTAL_LAPS;
    goRacing(race, karts);
    drive(race, karts, karts[0], total); // human 0 finishes early in race 1
    while (race.phase === 'racing') race.update(0.5, karts, track, isHuman);
    expect(race.phase).toBe('results');
    expect(karts[1].finishedAt).toBeNull();

    // Caller resets karts to the grid, then the next race starts straight from results.
    karts.forEach((k, i) => {
      const slot = track.grid[i];
      k.pos = { x: slot.pos.x, z: slot.pos.z };
      k.distance = slot.s;
      k.trackIndex = track.project(slot.pos).index;
      k.finishedAt = null;
    });
    const ev = goRacing(race, karts);
    expect(ev.map((e) => (e.kind === 'countdown' ? e.n : e.kind))).toEqual([3, 2, 1, 'go']);
    expect(race.time).toBe(0);

    // Nobody finishes for well over 30 s: a stale cutoff clock would end the race.
    for (let i = 0; i < 80; i++) race.update(0.5, karts, track, isHuman);
    expect(race.phase).toBe('racing');

    // Lap events start fresh too (no stale announced-lap state): lap 2 is announced again.
    const lapEv = drive(race, karts, karts[1], total);
    expect(lapEv).toContainEqual({ kind: 'lap', kartId: 1, lap: 2 });
    expect(lapEv).toContainEqual({ kind: 'finish', kartId: 1, place: 1 });
    expect(race.phase).toBe('racing');
  });
});
