import { expect, test } from 'vitest';
import { makeRoomCode, peerIdFor, controllerUrl, decodeClient, decodeServer } from './index';

test('makeRoomCode uses 4 unambiguous letters', () => {
  expect(makeRoomCode(() => 0)).toBe('AAAA');
  expect(makeRoomCode(() => 0.9999)).toBe('ZZZZ');
  for (let i = 0; i < 200; i++) expect(makeRoomCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
});
test('peerIdFor / controllerUrl', () => {
  expect(peerIdFor('kart')).toBe('racingcarts-KART');
  expect(controllerUrl('KART')).toBe('https://sabeq96.github.io/racing-carts/controller/?address=KART');
});
test('decodeClient accepts valid messages and JSON strings', () => {
  expect(decodeClient({ t: 'start' })).toEqual({ t: 'start' });
  expect(decodeClient('{"t":"hello","token":"abc","name":"Ola"}')).toEqual({ t: 'hello', token: 'abc', name: 'Ola' });
});
test('decodeClient clamps and sanitises input', () => {
  expect(decodeClient({ t: 'input', steer: 100, gas: 1, brake: false, item: 'yes' }))
    .toEqual({ t: 'input', steer: 1, gas: true, brake: false, item: true });
  expect(decodeClient({ t: 'input', steer: NaN })).toEqual({ t: 'input', steer: 0, gas: false, brake: false, item: false });
});
test('decodeClient trims hello name to 12 chars and defaults empty to "Player"', () => {
  expect((decodeClient({ t: 'hello', token: 'x', name: 'A'.repeat(50) }) as any).name).toHaveLength(12);
  expect((decodeClient({ t: 'hello', token: 'x', name: '   ' }) as any).name).toBe('Player');
});
test('decodeClient rejects garbage', () => {
  for (const bad of [null, 42, 'not json', {}, { t: 'nope' }, { t: 'hello', name: 'x' }, { t: 'hello', token: '' }])
    expect(decodeClient(bad)).toBeNull();
});
test('decodeServer round-trips a state message', () => {
  const s = { t: 'state', phase: 'racing', isHost: true, position: 2, racers: 6, lap: 1, totalLaps: 3, item: null, itemIcon: null, rolling: false, drift: 2 };
  expect(decodeServer(JSON.stringify(s))).toEqual(s);
  expect(decodeServer({ t: 'bogus' })).toBeNull();
});
test('decodeServer reads the drift level as 0, 1 or 2 (an older TV without it reads 0)', () => {
  const base = { t: 'state', phase: 'racing', isHost: false, position: 1, racers: 2, lap: 1, totalLaps: 3, item: null, itemIcon: null, rolling: false };
  expect(decodeServer({ ...base, drift: 1 })).toMatchObject({ drift: 1 });
  expect(decodeServer(base)).toMatchObject({ drift: 0 });
  expect(decodeServer({ ...base, drift: 7 })).toMatchObject({ drift: 0 });
  expect(decodeServer({ ...base, drift: '2' })).toMatchObject({ drift: 0 });
});
