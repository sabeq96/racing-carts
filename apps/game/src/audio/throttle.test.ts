import { expect, test } from 'vitest';
import { Throttle } from './throttle';

test('allows one per key per interval, keys are independent', () => {
  const t = new Throttle(300);
  expect(t.allow(0, 1000)).toBe(true);
  expect(t.allow(0, 1100)).toBe(false);
  expect(t.allow(1, 1100)).toBe(true);
  expect(t.allow(0, 1299)).toBe(false);
  expect(t.allow(0, 1300)).toBe(true);
  expect(t.allow(0, 1400)).toBe(false); // a refused call does not extend the window
});

test('a clock that goes backwards (new race) does not mute a key forever', () => {
  const t = new Throttle(300);
  expect(t.allow(2, 5000)).toBe(true);
  expect(t.allow(2, 100)).toBe(true);
});
