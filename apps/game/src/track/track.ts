import { Vec2, dist, wrapAngle } from '../math/vec2';
import type { TrackDef } from './trackDef';

export interface Track {
  /** Centre line sampled every ~1 m, closed (last→first implied); points[0] is the start line. */
  points: Vec2[];
  length: number;
  width: number;
  /** s wraps modulo length. Positive lateral is right of the direction of travel. */
  pointAt(s: number, lateral?: number): Vec2;
  headingAt(s: number): number;
  /** Returns s in [0, length), signed lateral, and the segment index. */
  project(p: Vec2, hintIndex?: number): { s: number; lateral: number; index: number };
  grid: { pos: Vec2; heading: number; s: number }[];
  itemBoxes: Vec2[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const DENSE_PER_SEGMENT = 20;
const HINT_WINDOW = 30;

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) };
}

/** Closed Catmull-Rom through all control points, then resampled at equal arc length (~1 m). */
function sampleCentreLine(controlPoints: [number, number][]): { points: Vec2[]; length: number } {
  const cp = controlPoints.map(([x, z]) => ({ x, z }));
  const n = cp.length;
  const dense: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = cp[(i - 1 + n) % n], p1 = cp[i], p2 = cp[(i + 1) % n], p3 = cp[(i + 2) % n];
    for (let k = 0; k < DENSE_PER_SEGMENT; k++) dense.push(catmullRom(p0, p1, p2, p3, k / DENSE_PER_SEGMENT));
  }
  const m = dense.length;
  const cum = [0];
  for (let i = 0; i < m; i++) cum.push(cum[i] + dist(dense[i], dense[(i + 1) % m]));
  const total = cum[m];
  const count = Math.max(3, Math.round(total));
  const step = total / count;
  const points: Vec2[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (j < m - 1 && cum[j + 1] < target) j++;
    const segLen = cum[j + 1] - cum[j];
    const t = segLen > 0 ? (target - cum[j]) / segLen : 0;
    const a = dense[j], b = dense[(j + 1) % m];
    points.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return { points, length: total };
}

export function buildTrack(def: TrackDef): Track {
  const { points, length } = sampleCentreLine(def.controlPoints);
  const n = points.length;
  const step = length / n; // metres per sample, ~1
  const width = def.width;

  const mod = (a: number, m: number) => ((a % m) + m) % m;

  // Unit tangent of each segment i→i+1.
  const segDir: Vec2[] = points.map((a, i) => {
    const b = points[(i + 1) % n];
    const l = dist(a, b) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  });
  // Smooth tangent at each vertex (average of adjacent segment directions).
  const vertDir: Vec2[] = segDir.map((d, i) => {
    const p = segDir[(i - 1 + n) % n];
    const x = p.x + d.x, z = p.z + d.z;
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  });

  const rightOf = (d: Vec2): Vec2 => ({ x: d.z, z: -d.x }); // heading θ: right = (cosθ, −sinθ), d = (sinθ, cosθ)

  function locate(s: number): { i: number; t: number } {
    const u = mod(s, length) / step;
    const i = Math.min(n - 1, Math.floor(u));
    return { i, t: u - i };
  }

  function pointAt(s: number, lateral = 0): Vec2 {
    const { i, t } = locate(s);
    const a = points[i], b = points[(i + 1) % n];
    const r = rightOf(segDir[i]);
    return { x: a.x + (b.x - a.x) * t + r.x * lateral, z: a.z + (b.z - a.z) * t + r.z * lateral };
  }

  function headingAt(s: number): number {
    const { i, t } = locate(s);
    const a = vertDir[i], b = vertDir[(i + 1) % n];
    return Math.atan2(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
  }

  function project(p: Vec2, hintIndex?: number): { s: number; lateral: number; index: number } {
    let bestD2 = Infinity, bestI = 0, bestT = 0;
    const test = (i: number) => {
      const a = points[i], d = segDir[i];
      const along = (p.x - a.x) * d.x + (p.z - a.z) * d.z;
      const t = Math.min(1, Math.max(0, along / step));
      const cx = a.x + d.x * step * t, cz = a.z + d.z * step * t;
      const d2 = (p.x - cx) ** 2 + (p.z - cz) ** 2;
      if (d2 < bestD2) { bestD2 = d2; bestI = i; bestT = t; }
    };
    if (hintIndex === undefined || !Number.isFinite(hintIndex) || 2 * HINT_WINDOW + 1 >= n) {
      for (let i = 0; i < n; i++) test(i);
    } else {
      const h = Math.round(hintIndex);
      for (let k = -HINT_WINDOW; k <= HINT_WINDOW; k++) test(mod(h + k, n));
    }
    const a = points[bestI], r = rightOf(segDir[bestI]);
    const t = bestT;
    const cx = a.x + segDir[bestI].x * step * t, cz = a.z + segDir[bestI].z * step * t;
    const lateral = (p.x - cx) * r.x + (p.z - cz) * r.z;
    // Guard against s landing on exactly `length` through rounding.
    const s = mod((bestI + bestT) * step, length);
    return { s: s >= length ? 0 : s, lateral, index: bestI };
  }

  const grid = Array.from({ length: 6 }, (_, i) => {
    const s = -(6 + 6 * Math.floor(i / 2));
    const lateral = i % 2 === 0 ? -3 : 3;
    return { pos: pointAt(s, lateral), heading: headingAt(s), s };
  });

  const itemBoxes: Vec2[] = [];
  for (const row of def.itemBoxRows)
    for (const lat of def.itemBoxLaterals) itemBoxes.push(pointAt(row * length, lat));

  const margin = width / 2;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const bounds = { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };

  return { points, length, width, pointAt, headingAt, project, grid, itemBoxes, bounds };
}
