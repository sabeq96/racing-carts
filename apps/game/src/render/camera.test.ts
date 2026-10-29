import { expect, test } from 'vitest';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { CAMERA_ALPHA, CAMERA_BETA, fitCamera } from './camera';

const b = buildTrack(TRACK_V1).bounds;
const aspect = 16 / 9;
const maxRadius = Math.max((b.maxX - b.minX) / aspect, b.maxZ - b.minZ) * 1.2 + 25;

test('camera angles are fixed', () => {
  expect(CAMERA_ALPHA).toBe(-Math.PI / 2);
  expect(CAMERA_BETA).toBe(0.9);
});

test('fitCamera: single kart → min radius, centred', () => {
  const r = fitCamera([{ x: 10, z: 20 }], 16 / 9, b);
  expect(r.radius).toBe(35);
  expect(r.target).toEqual({ x: 10, z: 20 });
});

test('fitCamera: spread karts never exceed whole-track radius', () => {
  const r = fitCamera([{ x: b.minX, z: b.minZ }, { x: b.maxX, z: b.maxZ }], aspect, b);
  expect(r.radius).toBeCloseTo(maxRadius, 9);
  const far = fitCamera([{ x: b.minX - 500, z: b.minZ - 500 }, { x: b.maxX + 500, z: b.maxZ + 500 }], aspect, b);
  expect(far.radius).toBeCloseTo(maxRadius, 9);
});

test('fitCamera: medium spread uses max(spanX / aspect, spanZ) * 1.2 + 25, target is the bbox centre', () => {
  // spanX 64 / (16/9) = 36 > spanZ 10 → 36 * 1.2 + 25 = 68.2
  const r = fitCamera([{ x: 0, z: 0 }, { x: 64, z: 10 }, { x: 20, z: 4 }], aspect, b);
  expect(r.radius).toBeCloseTo(68.2, 9);
  expect(r.target).toEqual({ x: 32, z: 5 });
  // spanZ dominates: 40 * 1.2 + 25 = 73
  expect(fitCamera([{ x: 0, z: 0 }, { x: 10, z: 40 }], aspect, b).radius).toBeCloseTo(73, 9);
});

test('fitCamera: no points → bounds centre at min radius', () => {
  const r = fitCamera([], aspect, b);
  expect(r.target).toEqual({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
  expect(r.radius).toBe(35);
});
