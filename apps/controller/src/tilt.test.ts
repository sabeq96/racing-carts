import { expect, test } from 'vitest';
import { gravityToRollDeg, rollToSteer } from './tilt';

test('level portrait-up wheel = 0°', () => expect(gravityToRollDeg(0, 9.8, 0)).toBeCloseTo(0));
test('turned right 30° in portrait', () => expect(gravityToRollDeg(-4.9, 8.487, 0)).toBeCloseTo(30, 0));
test('turned right 30° in landscape (angle 90)', () => expect(gravityToRollDeg(8.487, 4.9, 90)).toBeCloseTo(30, 0));
test('inverted gravity sign (iOS) still steers correctly after calibration', () => {
  const neutral = gravityToRollDeg(0, -9.8, 0);
  expect(rollToSteer(gravityToRollDeg(4.9, -8.487, 0), neutral)).toBeCloseTo(1);
});
test('rollToSteer dead-zone, linear, clamp, wrap', () => {
  expect(rollToSteer(2, 0)).toBe(0);
  expect(rollToSteer(16.5, 0)).toBeCloseTo(0.5);
  expect(rollToSteer(30, 0)).toBeCloseTo(1);
  expect(rollToSteer(-45, 0)).toBe(-1);
  expect(rollToSteer(-170, 180)).toBeCloseTo(7 / 27);
});
