import { afterAll, expect, test } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import type { Vec2 } from '../math/vec2';
import { CAMERA_ALPHA, CAMERA_BETA, CAMERA_FOV, MIN_RADIUS, fitCamera, wholeTrackRadius } from './camera';

const track = buildTrack(TRACK_V1);
const b = track.bounds;
const aspect = 16 / 9;
const maxRadius = wholeTrackRadius(aspect, b);
const centre = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };

// The real Babylon camera at 1920×1080, so the tests check the actual view/projection maths.
const engine = new NullEngine({ renderWidth: 1920, renderHeight: 1080, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
const scene = new Scene(engine);
const cam = new ArcRotateCamera('test', CAMERA_ALPHA, CAMERA_BETA, 10, Vector3.Zero(), scene);
cam.fov = CAMERA_FOV;
cam.minZ = 1;
cam.maxZ = 5000;
afterAll(() => engine.dispose());

/** Projects ground points to NDC through the Babylon camera placed where fitCamera says. */
function project(points: Vec2[], fit: { target: Vec2; radius: number }): { x: number; y: number }[] {
  cam.target = new Vector3(fit.target.x, 0, fit.target.z);
  cam.radius = fit.radius;
  cam.alpha = CAMERA_ALPHA;
  cam.beta = CAMERA_BETA;
  const viewProj = cam.getViewMatrix(true).multiply(cam.getProjectionMatrix(true));
  return points.map((p) => {
    const v = Vector3.TransformCoordinates(new Vector3(p.x, 0, p.z), viewProj as Matrix);
    return { x: v.x, y: v.y };
  });
}

/** Seeded points on the road: `n` karts at random s and lateral within the walls. */
function karts(seed: number, n: number, sFrom = 0, sSpan = track.length): Vec2[] {
  let a = seed;
  const rand = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => track.pointAt(sFrom + rand() * sSpan, (rand() * 2 - 1) * (track.width / 2 - 1)));
}

test('camera angles are fixed', () => {
  expect(CAMERA_ALPHA).toBe(-Math.PI / 2);
  expect(CAMERA_BETA).toBe(0.9);
});

test('fitCamera: single kart → min radius, kart near the screen centre', () => {
  const r = fitCamera([{ x: 10, z: 20 }], aspect, b);
  expect(r.radius).toBe(MIN_RADIUS);
  expect(r.target.x).toBe(10);
  expect(Math.abs(r.target.z - 20)).toBeLessThan(1);
  const [p] = project([{ x: 10, z: 20 }], r);
  expect(Math.abs(p.x)).toBeLessThan(0.01);
  expect(Math.abs(p.y)).toBeLessThan(0.05);
});

test('fitCamera: whole-track case is bounds-centred and never over the max radius', () => {
  const corners = [{ x: b.minX, z: b.minZ }, { x: b.maxX, z: b.maxZ }];
  const r = fitCamera(corners, aspect, b);
  expect(r.radius).toBeCloseTo(maxRadius, 9);
  expect(r.target.x).toBeCloseTo(centre.x, 9);
  expect(fitCamera([], aspect, b)).toEqual(r); // no karts → the same whole-track view
  const far = fitCamera([{ x: b.minX - 500, z: b.minZ - 500 }, { x: b.maxX + 500, z: b.maxZ + 500 }], aspect, b);
  expect(far.radius).toBeCloseTo(maxRadius, 9);
  expect(far.target.x).toBeCloseTo(centre.x, 9);
  expect(far.target.z).toBeCloseTo(r.target.z, 9);

  // Six karts spread evenly around the lap get exactly the whole-track framing too.
  const lap = Array.from({ length: 6 }, (_, i) => track.pointAt((i * track.length) / 6));
  const spread = fitCamera(lap, aspect, b);
  expect(spread.radius).toBeCloseTo(maxRadius, 9);
  expect(spread.target.x).toBeCloseTo(r.target.x, 9);
  expect(spread.target.z).toBeCloseTo(r.target.z, 9);

  // The track's near and far edges sit symmetrically, and the whole track fills ~90% of the height.
  const ys = project(track.points.flatMap((_, i) => [track.pointAt(i, -track.width / 2), track.pointAt(i, track.width / 2)]), r).map((p) => p.y);
  const top = Math.max(...ys), bottom = Math.min(...ys);
  expect(Math.abs(top + bottom)).toBeLessThan(0.03);
  expect(top).toBeGreaterThan(0.8);
  expect(top).toBeLessThanOrEqual(0.9 + 1e-6);
});

test('fitCamera: radius grows with spread, between min and max', () => {
  const two = fitCamera(karts(7, 2, 0, 60), aspect, b);
  const six = fitCamera(karts(7, 6), aspect, b);
  expect(two.radius).toBeGreaterThanOrEqual(MIN_RADIUS);
  expect(six.radius).toBeGreaterThanOrEqual(two.radius);
  expect(six.radius).toBeLessThanOrEqual(maxRadius);
});

test('fitCamera: framed karts always project inside NDC [-0.9, 0.9] at 16:9', () => {
  const cases: Vec2[][] = [[{ x: b.minX + 1, z: b.minZ + 1 }, { x: b.maxX - 1, z: b.maxZ - 1 }]];
  for (let seed = 1; seed <= 300; seed++) {
    const n = 1 + (seed % 6);
    // Mix of tight packs, mid-race spreads and karts all over the lap.
    const span = [20, 60, 120, 200, track.length][seed % 5];
    cases.push(karts(seed * 7919, n, (seed * 37) % track.length, span));
  }
  let filled = 0;
  for (const pts of cases) {
    const fit = fitCamera(pts, aspect, b);
    const ndc = project(pts, fit);
    for (const p of ndc) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.9);
    }
    // At the widest zoom the view is always the whole-track framing, never a shifted one.
    if (fit.radius >= maxRadius - 1e-6) expect(fit.target.x).toBeCloseTo(centre.x, 6);
    // Unclamped spreads use the screen: the karts reach well out from the centre.
    if (fit.radius > MIN_RADIUS && fit.radius < maxRadius) {
      expect(Math.max(...ndc.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))).toBeGreaterThan(0.4);
      filled++;
    }
  }
  expect(filled).toBeGreaterThan(50);
});
