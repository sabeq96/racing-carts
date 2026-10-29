import { expect, test } from 'vitest';
import { fitStage } from './hud';

test('the 1920×1080 HUD stage scales uniformly and is centred (letterboxed)', () => {
  expect(fitStage(1920, 1080)).toEqual({ scale: 1, x: 0, y: 0 });
  const small = fitStage(1280, 720);
  expect(small.scale).toBeCloseTo(2 / 3);
  expect(small.x).toBeCloseTo(0);
  expect(small.y).toBeCloseTo(0);
  expect(fitStage(1920, 1200)).toEqual({ scale: 1, x: 0, y: 60 }); // bars top and bottom
  expect(fitStage(2560, 1080)).toEqual({ scale: 1, x: 320, y: 0 }); // bars left and right
  expect(fitStage(960, 540).scale).toBe(0.5);
});
