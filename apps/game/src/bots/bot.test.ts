import { describe, expect, test } from 'vitest';
import { KART_COLORS, TOTAL_LAPS } from '@rc/shared';
import { createKart, resolveKartCollisions, stepKart, type Kart } from '../kart/kart';
import { wrapAngle } from '../math/vec2';
import { MAX_SPEED } from '../kart/tuning';
import { lapOf, updateProgress } from '../race/progress';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { botInput, createBotBrain, type BotBrain } from './bot';
import { mulberry32 } from '../test/rand';

const track = buildTrack(TRACK_V1);
const DT = 1 / 60;

describe('createBotBrain', () => {
  test('values stay inside the relaxed ranges', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const b = createBotBrain(rand);
      expect(b.speedFactor).toBeGreaterThanOrEqual(0.82);
      expect(b.speedFactor).toBeLessThanOrEqual(0.92);
      expect(b.lookahead).toBe(9);
      expect(Math.abs(b.laneOffset)).toBeLessThanOrEqual(3);
      expect(b.laneTimer).toBeGreaterThanOrEqual(3);
      expect(b.laneTimer).toBeLessThanOrEqual(6);
      expect(b.reaction).toBeGreaterThanOrEqual(0.2);
      expect(b.reaction).toBeLessThanOrEqual(0.5);
    }
  });

  test('the lane offset is re-picked every 3-6 s', () => {
    const rand = mulberry32(3);
    const b = createBotBrain(rand);
    const k = createKart(0, KART_COLORS[0], track.grid[0], track);
    const seen = new Set<number>();
    let changes = 0;
    let last = b.laneOffset;
    for (let i = 0; i < 60 * 60; i++) {
      botInput(b, k, track, DT, rand);
      seen.add(b.laneOffset);
      if (b.laneOffset !== last) changes++;
      last = b.laneOffset;
      expect(Math.abs(b.laneOffset)).toBeLessThanOrEqual(3);
    }
    // 60 s with a pick every 3-6 s: between 10 and 20 picks.
    expect(changes).toBeGreaterThanOrEqual(9);
    expect(changes).toBeLessThanOrEqual(20);
  });
});

describe('botInput', () => {
  test('never brakes or uses items, and steer stays in [-1, 1]', () => {
    const rand = mulberry32(11);
    const b = createBotBrain(rand);
    const k = createKart(0, KART_COLORS[0], track.grid[0], track);
    for (let i = 0; i < 60 * 30; i++) {
      const input = botInput(b, k, track, DT, rand);
      expect(input.brake).toBe(false);
      expect(input.item).toBe(false);
      expect(Math.abs(input.steer)).toBeLessThanOrEqual(1);
      stepKart(k, input, track, DT);
      updateProgress(k, track);
    }
  });

  test('gas is off above the target speed and on below it; boost raises the target', () => {
    const rand = mulberry32(5);
    const b: BotBrain = { ...createBotBrain(rand), speedFactor: 0.9, laneOffset: 0, laneTimer: 99 };
    const k = createKart(0, KART_COLORS[0], track.grid[0], track);
    k.speed = 1;
    expect(botInput(b, k, track, DT, rand).gas).toBe(true);
    k.speed = MAX_SPEED; // above MAX_SPEED * 0.9
    expect(botInput(b, k, track, DT, rand).gas).toBe(false);
    k.effects = [{ kind: 'boost', remaining: 1 }];
    expect(botInput(b, k, track, DT, rand).gas).toBe(true);
  });

  test('a bot alone on TRACK_V1 finishes a lap within 45 simulated seconds without stalling', () => {
    const rand = mulberry32(1);
    const b = createBotBrain(rand);
    const k = createKart(0, KART_COLORS[0], track.grid[0], track);
    let t = 0;
    let slow = 0; // consecutive steps below walking pace
    let worstStall = 0;
    while (t < 45 && lapOf(k, track) < 2) {
      stepKart(k, botInput(b, k, track, DT, rand), track, DT);
      updateProgress(k, track);
      t += DT;
      slow = k.speed < 3 && t > 3 ? slow + 1 : 0;
      worstStall = Math.max(worstStall, slow);
    }
    expect(lapOf(k, track)).toBeGreaterThanOrEqual(2);
    expect(worstStall * DT).toBeLessThan(1);
  });

  test('bot respects its speed cap', () => {
    const rand = mulberry32(2);
    const b = createBotBrain(rand);
    const k = createKart(0, KART_COLORS[0], track.grid[0], track);
    let maxSpeed = 0;
    for (let i = 0; i < 60 * 60; i++) {
      stepKart(k, botInput(b, k, track, DT, rand), track, DT);
      updateProgress(k, track);
      maxSpeed = Math.max(maxSpeed, k.speed);
    }
    expect(maxSpeed).toBeLessThanOrEqual(MAX_SPEED * b.speedFactor + 0.5);
    expect(maxSpeed).toBeGreaterThan(MAX_SPEED * 0.5); // and it does actually drive
  });

  test('a bot does not slow to a crawl in corners (slows a little, never stalls)', () => {
    const rand = mulberry32(4);
    const b = createBotBrain(rand);
    const k = createKart(0, KART_COLORS[0], track.grid[0], track);
    let minSpeed = Infinity;
    for (let i = 0; i < 60 * 60; i++) {
      stepKart(k, botInput(b, k, track, DT, rand), track, DT);
      updateProgress(k, track);
      if (i > 60 * 6) minSpeed = Math.min(minSpeed, k.speed);
    }
    expect(minSpeed).toBeGreaterThan(8);
  });

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    test(`six bots finish ${TOTAL_LAPS} laps within 3 minutes with collisions on (seed ${seed})`, () => {
      const rand = mulberry32(seed * 101);
      const karts: Kart[] = track.grid.map((g, i) => createKart(i, KART_COLORS[i], g, track));
      const brains = karts.map(() => createBotBrain(rand));
      const done: (number | null)[] = karts.map(() => null);
      const goal = TOTAL_LAPS * track.length;
      let t = 0;
      let minSpeed = Infinity; // slowest any kart gets after the opening 8 s
      while (t < 180 && done.some((d) => d === null)) {
        karts.forEach((k, i) => stepKart(k, botInput(brains[i], k, track, DT, rand), track, DT));
        resolveKartCollisions(karts);
        t += DT;
        karts.forEach((k, i) => {
          updateProgress(k, track);
          if (t > 8) minSpeed = Math.min(minSpeed, k.speed);
          if (done[i] === null && k.distance >= goal) done[i] = t;
        });
      }
      expect(done.every((d) => d !== null)).toBe(true);
      expect(minSpeed).toBeGreaterThanOrEqual(8);
    });
  }
});

describe('recovery from a bad pose', () => {
  const S = 20; // on the straight after the start line
  const cases: [string, number, number][] = [
    ['facing backwards', 0, Math.PI],
    ['at the right wall, facing it', 5, Math.PI / 2],
    ['at the left wall, facing it', -5, -Math.PI / 2],
  ];
  for (const [name, lateral, turn] of cases) {
    test(`a stopped kart ${name} gets going again and lines up with the track`, () => {
      const rand = mulberry32(9);
      const b = createBotBrain(rand);
      const k = createKart(0, KART_COLORS[0], track.grid[0], track);
      k.pos = track.pointAt(S, lateral);
      k.heading = track.headingAt(S) + turn;
      k.speed = 0;
      k.trackIndex = track.project(k.pos).index;
      k.distance = S;
      for (let i = 0; i < 60 * 5; i++) {
        stepKart(k, botInput(b, k, track, DT, rand), track, DT);
        updateProgress(k, track);
      }
      const pr = track.project(k.pos, k.trackIndex);
      expect(k.speed).toBeGreaterThan(10);
      expect(Math.abs(wrapAngle(k.heading - track.headingAt(pr.s)))).toBeLessThan(0.5);
      expect(k.distance).toBeGreaterThan(S);
    });
  }
});
