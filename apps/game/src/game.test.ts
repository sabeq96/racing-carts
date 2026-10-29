import { expect, test } from 'vitest';
import { KART_COLORS, NEUTRAL_INPUT } from '@rc/shared';
import { buildTrack } from './track/track';
import { TRACK_V1 } from './track/trackDef';
import { Game, type Driver } from './game';

const track = buildTrack(TRACK_V1);
const gas = { steer: 0, gas: true, brake: false, item: false };
const drivers = (humans: number[]) => (id: number): Driver =>
  humans.includes(id)
    ? { kind: 'human', name: 'P' + id, input: () => gas }
    : { kind: 'bot', name: 'Bot', input: () => NEUTRAL_INPUT };

test('setupKarts places karts on grid slots with slot colours', () => {
  const g = new Game(track);
  g.setupKarts(4);
  expect(g.karts.map((k) => k.id)).toEqual([0, 1, 2, 3]);
  expect(g.karts.map((k) => k.color)).toEqual(KART_COLORS.slice(0, 4));
  expect(g.karts[2].pos).toEqual(track.grid[2].pos);
  g.setupKarts(9);
  expect(g.karts).toHaveLength(6);
});

test('karts ignore input until racing, then the human kart drives', () => {
  const g = new Game(track);
  g.setupKarts(2);
  const d = drivers([0]);
  for (let i = 0; i < 30; i++) g.step(1 / 60, d);
  expect(g.karts[0].speed).toBe(0);
  g.race.start();
  const events = [];
  for (let i = 0; i < 400 && g.race.phase !== 'racing'; i++) events.push(...g.step(1 / 60, d));
  expect(events.map((e) => e.kind)).toEqual(['countdown', 'countdown', 'countdown', 'go']);
  expect(g.karts[0].speed).toBe(0);
  for (let i = 0; i < 60; i++) g.step(1 / 60, d);
  expect(g.karts[0].speed).toBeGreaterThan(5);
  expect(g.karts[1].speed).toBe(0);
  expect(g.karts[0].distance).toBeGreaterThan(g.karts[1].distance);
});

test('humanKartIds reflects the drivers of the latest step', () => {
  const g = new Game(track);
  g.setupKarts(3);
  expect(g.humanKartIds()).toEqual([]);
  g.step(1 / 60, drivers([0, 2]));
  expect(g.humanKartIds()).toEqual([0, 2]);
});
