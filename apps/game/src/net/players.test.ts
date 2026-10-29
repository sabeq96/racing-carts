import { expect, test } from 'vitest';
import { PlayerRegistry } from './players';

test('slots fill lowest-first and cap at 6', () => {
  const r = new PlayerRegistry();
  for (let i = 0; i < 6; i++) expect(r.join('t' + i, 'P' + i, 'lobby')).toEqual({ slot: i, rejoined: false });
  expect(r.join('t6', 'P6', 'lobby')).toBe('full');
});
test('lobby disconnect frees the slot only after the 15 s grace; next join reuses lowest free slot', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby'); r.join('b', 'B', 'lobby');
  r.disconnect('a', 'lobby', 1000);
  expect(r.bySlot(0)).toMatchObject({ token: 'a', connected: false });
  expect(r.purgeExpired(15999)).toEqual([]);
  expect(r.join('c', 'C', 'lobby')).toEqual({ slot: 2, rejoined: false });
  expect(r.purgeExpired(16000)).toEqual(['a']);
  expect(r.bySlot(0)).toBeUndefined();
  expect(r.join('d', 'D', 'lobby')).toEqual({ slot: 0, rejoined: false });
});
test('lobby rejoin within grace keeps slot and join order, so the host comes back as host', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby'); r.join('b', 'B', 'lobby');
  r.disconnect('a', 'lobby', 0);
  expect(r.hostToken()).toBe('b'); // in grace, but not connected
  expect(r.join('a', 'A2', 'lobby')).toEqual({ slot: 0, rejoined: true });
  expect(r.byToken('a')).toMatchObject({ name: 'A2', connected: true });
  expect(r.hostToken()).toBe('a');
  expect(r.purgeExpired(60000)).toEqual([]); // back in time: no longer expiring
  expect(r.bySlot(0)?.token).toBe('a');
});
test('a disconnect outside the lobby never expires', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby');
  r.disconnect('a', 'racing', 0);
  expect(r.purgeExpired(1e9)).toEqual([]);
  expect(r.bySlot(0)?.connected).toBe(false);
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
test('removeDisconnected drops every disconnected player (grace or not) and frees their slots', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby'); r.join('b', 'B', 'lobby'); r.join('c', 'C', 'lobby');
  r.disconnect('b', 'racing');
  r.disconnect('c', 'lobby', 0);
  expect(r.removeDisconnected().sort()).toEqual(['b', 'c']);
  expect(r.all().map((p) => p.token)).toEqual(['a']);
  expect(r.removeDisconnected()).toEqual([]);
  // A returning phone is simply a new player in the lowest free slot.
  expect(r.join('c', 'C', 'results')).toEqual({ slot: 1, rejoined: false });
});
