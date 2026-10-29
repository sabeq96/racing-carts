import { expect, test } from 'vitest';
import { FixedStepper } from './loop';

test('FixedStepper runs floor(realDt*hz) steps and carries remainder', () => {
  const s = new FixedStepper(60);
  let n = 0;
  expect(s.advance(1 / 30 + 0.001, () => n++)).toBe(2);
  expect(s.advance(1 / 60, () => n++)).toBe(1);
  expect(n).toBe(3);
});

test('FixedStepper passes the fixed dt to every step', () => {
  const s = new FixedStepper(50);
  const dts: number[] = [];
  s.advance(0.05, (dt) => dts.push(dt));
  expect(dts).toEqual([0.02, 0.02]);
});

test('FixedStepper accumulates small frames until a step is due', () => {
  const s = new FixedStepper(60);
  expect(s.advance(0.01, () => {})).toBe(0);
  expect(s.advance(0.01, () => {})).toBe(1);
});

test('FixedStepper clamps huge dt', () => expect(new FixedStepper(60).advance(5, () => {})).toBe(15));

test('FixedStepper ignores negative or non-finite dt', () => {
  const s = new FixedStepper(60);
  expect(s.advance(-1, () => {})).toBe(0);
  expect(s.advance(NaN, () => {})).toBe(0);
  expect(s.advance(1 / 60, () => {})).toBe(1);
});
