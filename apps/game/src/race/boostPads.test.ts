import { describe, expect, test } from 'vitest';
import { KART_COLORS } from '@rc/shared';
import { createKart, effectLeft, type Kart } from '../kart/kart';
import { dist } from '../math/vec2';
import { createWorld } from '../powerups/world';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { BoostPads, PAD_BOOST, PAD_COOLDOWN, PAD_LENGTH, PAD_WIDTH } from './boostPads';

const DT = 1 / 60;
// TRACK_V1's road with a single pad on the start straight, 1 m right of the centre line.
const track = buildTrack({ ...TRACK_V1, boostPads: [{ s: 0.1, lateral: 1 }] });
const padS = 0.1 * track.length;

function kartAt(s: number, lateral: number): Kart {
  const k = createKart(0, KART_COLORS[0], track.grid[0], track);
  k.pos = track.pointAt(s, lateral);
  k.heading = track.headingAt(s);
  k.trackIndex = track.project(k.pos).index;
  return k;
}

function touch(k: Kart): { boost: number; sfx: readonly string[] } {
  const world = createWorld([k], track);
  new BoostPads(track).update(DT, [k], world);
  return { boost: effectLeft(k, 'boost'), sfx: world.drainSfx() };
}

describe('boost pads', () => {
  test('the track places each pad at its lap fraction and lateral, facing along the road', () => {
    expect(track.boostPads).toHaveLength(1);
    const p = track.boostPads[0];
    expect(p.s).toBeCloseTo(padS, 6);
    expect(p.lateral).toBe(1);
    expect(dist(p.pos, track.pointAt(padS, 1))).toBeLessThan(1e-9);
    expect(p.heading).toBeCloseTo(track.headingAt(padS), 9);
    expect(buildTrack({ ...TRACK_V1, boostPads: undefined }).boostPads).toEqual([]);
  });

  test('a kart inside the 4 m × 4 m rectangle gets a 1 s boost and a boost sound', () => {
    expect(PAD_LENGTH).toBe(4);
    expect(PAD_WIDTH).toBe(4);
    expect(PAD_BOOST).toBe(1);
    for (const [ds, dl] of [[0, 0], [1.9, 1.9], [-1.9, -1.9], [1.9, -1.9]]) {
      const hit = touch(kartAt(padS + ds, 1 + dl));
      expect(hit.boost, `${ds}, ${dl}`).toBeCloseTo(1, 9);
      expect(hit.sfx).toEqual(['boost']);
    }
  });

  test('a kart outside the rectangle gets nothing', () => {
    for (const [ds, dl] of [[2.1, 0], [-2.1, 0], [0, 2.1], [0, -2.1], [30, 0]]) {
      const miss = touch(kartAt(padS + ds, 1 + dl));
      expect(miss.boost, `${ds}, ${dl}`).toBe(0);
      expect(miss.sfx).toEqual([]);
    }
  });

  test('a per-kart cooldown of 0.5 s: a kart sitting on the pad triggers it again only after the cooldown', () => {
    expect(PAD_COOLDOWN).toBe(0.5);
    const k = kartAt(padS, 1);
    const other = kartAt(padS + 1, 0);
    other.id = 1;
    const world = createWorld([k, other], track);
    const pads = new BoostPads(track);
    let sounds = 0;
    for (let i = 0; i < 29; i++) {
      pads.update(DT, [k, other], world);
      sounds += world.drainSfx().length;
    }
    expect(sounds).toBe(2); // one each, the other kart has its own cooldown
    pads.update(DT, [k, other], world);
    pads.update(DT, [k, other], world);
    expect(world.drainSfx()).toEqual(['boost', 'boost']); // 0.5 s later, both again
  });

  test('a pad refreshes a running boost instead of stacking on it', () => {
    const k = kartAt(padS, 1);
    k.effects.push({ kind: 'boost', remaining: 0.4 });
    touch(k);
    expect(k.effects).toEqual([{ kind: 'boost', remaining: 1 }]);
    k.effects[0].remaining = 1.4; // an item boost with more left is not cut short
    const world = createWorld([k], track);
    new BoostPads(track).update(DT, [k], world);
    expect(k.effects).toEqual([{ kind: 'boost', remaining: 1.4 }]);
  });
});

describe('TRACK_V1 pads', () => {
  const v1 = buildTrack(TRACK_V1);
  test('three pads: one on the start straight past the grid, two further round', () => {
    expect(v1.boostPads).toHaveLength(3);
    const fractions = v1.boostPads.map((p) => p.s / v1.length);
    expect(fractions[0]).toBeGreaterThan(0.05);
    expect(fractions[0]).toBeLessThan(0.12);
  });
  test('every pad lies fully on the road and clear of the item boxes', () => {
    for (const p of v1.boostPads) {
      expect(Math.abs(p.lateral) + PAD_WIDTH / 2).toBeLessThanOrEqual(v1.width / 2 - 0.5);
      for (const b of v1.itemBoxes) expect(dist(p.pos, b)).toBeGreaterThan(8);
    }
  });
});
