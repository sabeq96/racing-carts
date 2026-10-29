import { describe, expect, test } from 'vitest';
import { TOTAL_LAPS } from '@rc/shared';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { createKart, type Kart } from '../kart/kart';
import { isFinished, lapOf, rankKarts, updateProgress } from './progress';

const track = buildTrack(TRACK_V1);
const L = track.length;

function kartAt(s: number, id = 0): Kart {
  return createKart(id, '#fff', { pos: track.pointAt(s), heading: track.headingAt(s), s }, track);
}

/** Moves the kart along the centre line from `from` to `to` (unwrapped s) in <=2 m steps. */
function walk(k: Kart, from: number, to: number, step = 2): void {
  const dir = Math.sign(to - from);
  for (let s = from; dir > 0 ? s < to : s > to; s += dir * step) {
    const next = dir > 0 ? Math.min(to, s + step) : Math.max(to, s - step);
    k.pos = track.pointAt(next);
    updateProgress(k, track);
  }
}

describe('progress', () => {
  test('driving forward one full length completes a lap', () => {
    const k = kartAt(-6);
    expect(lapOf(k, track)).toBe(1);
    walk(k, -6, L + 1);
    expect(lapOf(k, track)).toBe(2);
    expect(k.distance).toBeCloseTo(L + 1, 0);
    expect(isFinished(k, track)).toBe(false);
  });

  test('reversing over the start line does not gain a lap', () => {
    const k = kartAt(5);
    walk(k, 5, -20);
    expect(lapOf(k, track)).toBe(1);
    expect(k.distance).toBeCloseTo(-20, 0);
    walk(k, -20, 5);
    expect(lapOf(k, track)).toBe(1);
    expect(k.distance).toBeCloseTo(5, 0);
  });

  test('back-and-forth across the line 10x never exceeds 1 lap', () => {
    const k = kartAt(5);
    for (let i = 0; i < 10; i++) {
      walk(k, 5, -20);
      expect(lapOf(k, track)).toBe(1);
      walk(k, -20, 5);
      expect(lapOf(k, track)).toBe(1);
    }
    expect(k.distance).toBeCloseTo(5, 0);
    expect(k.distance).toBeLessThan(L);
  });

  test('hairpin: walking s 180→260 in 2 m steps increases distance monotonically', () => {
    const k = kartAt(180);
    let prev = k.distance;
    for (let s = 182; s <= 260; s += 2) {
      k.pos = track.pointAt(s);
      updateProgress(k, track);
      expect(k.distance).toBeGreaterThan(prev);
      prev = k.distance;
    }
    expect(k.distance).toBeCloseTo(260, 0);
  });

  test('updateProgress keeps trackIndex in sync with the projection', () => {
    const k = kartAt(0);
    k.pos = track.pointAt(20);
    updateProgress(k, track);
    expect(k.trackIndex).toBe(track.project(k.pos).index);
  });

  test('lapOf clamps to [1, TOTAL_LAPS]; isFinished at TOTAL_LAPS·length', () => {
    const k = kartAt(0);
    k.distance = -10;
    expect(lapOf(k, track)).toBe(1);
    k.distance = L * TOTAL_LAPS - 0.01;
    expect(lapOf(k, track)).toBe(TOTAL_LAPS);
    expect(isFinished(k, track)).toBe(false);
    k.distance = L * TOTAL_LAPS;
    expect(isFinished(k, track)).toBe(true);
    k.distance = L * (TOTAL_LAPS + 2);
    expect(lapOf(k, track)).toBe(TOTAL_LAPS);
  });

  test('rankKarts: finished first by time, then by distance', () => {
    const a = kartAt(0, 0), b = kartAt(0, 1), c = kartAt(0, 2), d = kartAt(0, 3);
    a.distance = 500; // unfinished, far
    b.distance = L * 3; b.finishedAt = 60;
    c.distance = L * 3 + 5; c.finishedAt = 50;
    d.distance = 100; // unfinished, behind
    const ranked = rankKarts([a, b, c, d]);
    expect(ranked.map((k) => k.id)).toEqual([2, 1, 0, 3]);
  });

  test('rankKarts does not mutate its input', () => {
    const a = kartAt(0, 0), b = kartAt(0, 1);
    b.distance = 50;
    const input = [a, b];
    rankKarts(input);
    expect(input.map((k) => k.id)).toEqual([0, 1]);
  });
});
