import { expect, test } from 'vitest';
import { createPressLatch } from './latch';

test('a tap shorter than one send interval still goes out as one press', () => {
  const latch = createPressLatch();
  let level = false;
  latch.press();
  level = true;
  level = false; // released before the next 30 Hz send
  expect(latch.read(level)).toBe(true);
  expect(latch.read(level)).toBe(false);
});

test('a held button reads as held; nothing pressed reads false', () => {
  const latch = createPressLatch();
  expect(latch.read(false)).toBe(false);
  latch.press();
  expect(latch.read(true)).toBe(true);
  expect(latch.read(true)).toBe(true);
  expect(latch.read(false)).toBe(false);
});
