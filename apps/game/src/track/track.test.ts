import { describe, expect, test } from 'vitest';
import { dist, wrapAngle } from '../math/vec2';
import { TRACK_V1 } from './trackDef';
import { buildTrack } from './track';

const t = buildTrack(TRACK_V1);

describe('track', () => {
  test('length is a ~25–35 s lap', () => {
    expect(t.length).toBeGreaterThan(380);
    expect(t.length).toBeLessThan(650);
  });
  test('samples ~1 m apart', () =>
    t.points.forEach((p, i) => expect(dist(p, t.points[(i + 1) % t.points.length])).toBeLessThan(1.3)));
  test('no two non-neighbouring sections closer than 1.5×width', () => {
    for (let i = 0; i < t.points.length; i += 3)
      for (let j = 0; j < t.points.length; j += 3) {
        const gap = Math.min(Math.abs(i - j), t.points.length - Math.abs(i - j));
        if (gap > 40) expect(dist(t.points[i], t.points[j])).toBeGreaterThan(t.width * 1.5);
      }
  });
  test('heading convention: start straight runs +z so heading≈0', () =>
    expect(t.headingAt(0)).toBeCloseTo(0, 1));
  test('project inverts pointAt', () => {
    const p = t.pointAt(123.4, 2.5);
    const r = t.project(p);
    expect(r.s).toBeCloseTo(123.4, 0);
    expect(r.lateral).toBeCloseTo(2.5, 1);
  });
  test('project with hint stays local near hairpin', () => {
    const s = 200;
    const r = t.project(t.pointAt(s, 0), Math.round(s));
    expect(r.s).toBeCloseTo(s, 0);
  });
  test('grid has 6 slots behind start, 2 abreast', () => {
    expect(t.grid).toHaveLength(6);
    expect(t.grid[0].s).toBeLessThan(0);
    expect(dist(t.grid[0].pos, t.grid[1].pos)).toBeCloseTo(6, 0);
  });
  test('8 item boxes', () => expect(t.itemBoxes).toHaveLength(8));

  test('pointAt wraps modulo length (both directions)', () => {
    expect(dist(t.pointAt(t.length + 10), t.pointAt(10))).toBeLessThan(1e-6);
    expect(dist(t.pointAt(-5), t.pointAt(t.length - 5))).toBeLessThan(1e-6);
  });
  test('positive lateral is right of travel direction', () => {
    // start straight runs +z, right = +x
    expect(t.pointAt(10, 3).x).toBeGreaterThan(t.pointAt(10, 0).x + 2.9);
  });
  test('project with hint handles index wrap-around and s in [0, length)', () => {
    const n = t.points.length;
    for (const s of [0.5, 2, t.length - 3, t.length - 0.5]) {
      const r = t.project(t.pointAt(s, -1.5), Math.round(s) % n);
      expect(r.s).toBeGreaterThanOrEqual(0);
      expect(r.s).toBeLessThan(t.length);
      const ds = Math.abs(r.s - s);
      expect(Math.min(ds, t.length - ds)).toBeLessThan(0.5);
      expect(r.lateral).toBeCloseTo(-1.5, 1);
    }
  });
  test('project without hint agrees with hinted result', () => {
    const p = t.pointAt(300, 1);
    expect(t.project(p).s).toBeCloseTo(t.project(p, 290).s, 3);
  });
  test('grid slots lie on the track behind the start line, pole at front', () => {
    t.grid.forEach((g, i) => {
      const r = t.project(g.pos);
      expect(Math.abs(r.lateral)).toBeCloseTo(3, 1);
      expect(r.lateral > 0).toBe(i % 2 === 1);
      expect(g.s).toBeCloseTo(-(6 + 6 * Math.floor(i / 2)), 6);
      expect(wrapAngle(g.heading - t.headingAt(g.s))).toBeCloseTo(0, 6);
    });
  });
  test('item boxes lie within track width and bounds contain the track', () => {
    t.itemBoxes.forEach((b) => expect(Math.abs(t.project(b).lateral)).toBeLessThanOrEqual(4.6));
    t.points.forEach((p) => {
      expect(p.x - t.width / 2).toBeGreaterThanOrEqual(t.bounds.minX - 1e-6);
      expect(p.x + t.width / 2).toBeLessThanOrEqual(t.bounds.maxX + 1e-6);
      expect(p.z - t.width / 2).toBeGreaterThanOrEqual(t.bounds.minZ - 1e-6);
      expect(p.z + t.width / 2).toBeLessThanOrEqual(t.bounds.maxZ + 1e-6);
    });
  });
  test('shape: has a long straight, a hairpin and an S-bend', () => {
    const n = t.points.length;
    const h = (i: number) => t.headingAt(i);
    // long straight: >=80 m with <3° heading change
    let best = 0;
    for (let i = 0; i < n; i += 5) {
      let k = 0;
      while (k < n && Math.abs(wrapAngle(h((i + k) % n) - h(i))) < 0.05) k += 5;
      best = Math.max(best, k);
    }
    expect(best).toBeGreaterThanOrEqual(80);
    // hairpin: >=120° of turning within 40 m
    let maxTurn = 0;
    for (let i = 0; i < n; i += 2)
      maxTurn = Math.max(maxTurn, Math.abs(wrapAngle(h((i + 40) % n) - h(i))));
    expect(maxTurn).toBeGreaterThan((120 * Math.PI) / 180);
    // S-bend: both left and right turns exist (signed curvature changes sign with real magnitude)
    let left = 0, right = 0;
    for (let i = 0; i < n; i++) {
      const d = wrapAngle(h((i + 10) % n) - h(i));
      if (d > 0.15) right++;
      if (d < -0.15) left++;
    }
    expect(left).toBeGreaterThan(20);
    expect(right).toBeGreaterThan(20);
  });
});
