import { describe, expect, test } from 'vitest';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { POND, POND_SHORE, centreDistance, cloudAt, edgeFade, nearFade, screenFade, wrapInto, type Area } from './decor';

const track = buildTrack(TRACK_V1);

const area: Area = { minX: -50, minZ: 10, sizeX: 200, sizeZ: 100 };

describe('clouds', () => {
  test('wrapInto keeps values inside [min, min + size) from both sides', () => {
    expect(wrapInto(-50, -50, 200)).toBe(-50);
    expect(wrapInto(150, -50, 200)).toBe(-50);
    expect(wrapInto(151, -50, 200)).toBeCloseTo(-49);
    expect(wrapInto(-51, -50, 200)).toBeCloseTo(149);
    expect(wrapInto(1234.5, -50, 200)).toBeCloseTo(34.5);
    expect(wrapInto(-987, -50, 200)).toBeCloseTo(13);
  });

  test('clouds drift with the wind and wrap around the play area', () => {
    const at = { x: 0, z: 0 };
    let prevX = 0;
    let wrapped = 0;
    for (let t = 0; t < 2000; t += 0.5) {
      cloudAt(100, 50, t, area, at);
      expect(at.x).toBeGreaterThanOrEqual(area.minX);
      expect(at.x).toBeLessThan(area.minX + area.sizeX);
      expect(at.z).toBeGreaterThanOrEqual(area.minZ);
      expect(at.z).toBeLessThan(area.minZ + area.sizeZ);
      if (t > 0 && at.x < prevX) wrapped++;
      else if (t > 0) expect(at.x - prevX).toBeLessThan(1); // slow drift, no jumps
      prevX = at.x;
    }
    expect(wrapped).toBeGreaterThan(2);
  });

  test('a cloud shrinks to nothing at the wrap edges, so wrapping never pops', () => {
    expect(edgeFade(-50, 60, area, 30)).toBe(0);
    expect(edgeFade(150, 60, area, 30)).toBe(0);
    expect(edgeFade(40, 10, area, 30)).toBe(0);
    expect(edgeFade(-35, 60, area, 30)).toBeCloseTo(0.5);
    expect(edgeFade(50, 60, area, 30)).toBe(1);
  });

  test('clouds melt away over the middle of the screen and show near its edges', () => {
    expect(screenFade(0, 0)).toBe(0);
    expect(screenFade(0.3, 0.3)).toBe(0);
    expect(screenFade(0.9, 0)).toBe(1);
    expect(screenFade(0, 1.1)).toBe(1);
    expect(screenFade(-0.85, -0.6)).toBe(1);
    const mid = screenFade(0.62, 0);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe('cloud size on screen', () => {
  test('clouds right by the lens shrink away; distant ones stay', () => {
    expect(nearFade(20)).toBe(0);
    expect(nearFade(40)).toBe(0);
    expect(nearFade(47.5)).toBeCloseTo(0.5);
    expect(nearFade(55)).toBe(1);
    expect(nearFade(200)).toBe(1);
  });
});

describe('pond', () => {
  test('the whole pond, shore included, stays at least width/2 + 8 m from the centre line', () => {
    const outer = POND.r * 1.11 + POND_SHORE; // the waterline wobbles up to 11 % out
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 36) {
      const d = centreDistance(track, POND.x + Math.cos(a) * outer, POND.z + Math.sin(a) * outer);
      expect(d).toBeGreaterThanOrEqual(track.width / 2 + 8);
    }
  });
});
