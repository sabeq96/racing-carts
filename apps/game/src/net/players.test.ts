import { expect, test } from 'vitest';
import { PlayerRegistry } from './players';

test('slots fill lowest-first and cap at 6', () => {
  const r = new PlayerRegistry();
  for (let i = 0; i < 6; i++) expect(r.join('t' + i, 'P' + i, 'lobby')).toEqual({ slot: i, rejoined: false });
  expect(r.join('t6', 'P6', 'lobby')).toBe('full');
});
test('lobby disconnect frees slot; next join reuses lowest free slot', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby'); r.join('b', 'B', 'lobby');
  r.disconnect('a', 'lobby');
  expect(r.join('c', 'C', 'lobby')).toEqual({ slot: 0, rejoined: false });
});
test('mid-race disconnect keeps slot; same token rejoins same slot', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby'); r.join('b', 'B', 'lobby');
  r.disconnect('a', 'racing');
  expect(r.bySlot(0)?.connected).toBe(false);
  expect(r.join('a', 'A', 'racing')).toEqual({ slot: 0, rejoined: true });
  expect(r.bySlot(0)?.connected).toBe(true);
});
test('new phone during race takes a free slot', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby');
  expect(r.join('z', 'Z', 'racing')).toEqual({ slot: 1, rejoined: false });
});
test('host is earliest-joined connected player and passes on', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby'); r.join('b', 'B', 'lobby');
  expect(r.hostToken()).toBe('a');
  r.disconnect('a', 'racing'); expect(r.hostToken()).toBe('b');
  r.join('a', 'A', 'racing'); expect(r.hostToken()).toBe('a');
});
