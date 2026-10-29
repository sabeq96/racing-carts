import { beforeEach, describe, expect, test } from 'vitest';
import type { Phase } from '@rc/shared';
import { MAX_SPEED } from '../kart/tuning';
import type { Audio } from './audio';
import { SoundDirector, type DirectorSource } from './director';

let played: string[];
let musicCalls: Array<string | null>;
let engineCalls: Array<number | null>;
const audio: Audio = {
  load: async () => {},
  play: (n) => void played.push(n),
  music: (n) => void musicCalls.push(n),
  engine: (s) => void engineCalls.push(s),
  unlock: () => {},
};

let walls: number[];
let bumps: number[];
let sfx: string[];
let phase: Phase;
let speeds: number[];
const source: DirectorSource = {
  drainWallHits: () => walls.splice(0),
  drainKartBumps: () => bumps.splice(0),
  world: { drainSfx: () => sfx.splice(0) },
  race: { get phase() { return phase; } },
  get karts() { return speeds.map((speed, id) => ({ id, speed })); },
};

let dir: SoundDirector;
beforeEach(() => {
  played = [];
  musicCalls = [];
  engineCalls = [];
  walls = [];
  bumps = [];
  sfx = [];
  phase = 'racing';
  speeds = [0, 0];
  dir = new SoundDirector(audio);
});

describe('race events', () => {
  test('countdown numbers beep, go goes', () => {
    dir.raceEvent({ kind: 'countdown', n: 3 }, []);
    dir.raceEvent({ kind: 'countdown', n: 1 }, []);
    dir.raceEvent({ kind: 'go' }, []);
    expect(played).toEqual(['countdown_beep', 'countdown_beep', 'countdown_go']);
  });

  test('laps, final lap and finish sound for human karts only; the final lap replaces the lap chime', () => {
    dir.raceEvent({ kind: 'lap', kartId: 0, lap: 2 }, [0]);
    dir.raceEvent({ kind: 'lap', kartId: 1, lap: 2 }, [0]); // a bot
    expect(played).toEqual(['lap_complete']);
    played.length = 0;
    dir.raceEvent({ kind: 'lap', kartId: 0, lap: 3 }, [0]);
    dir.raceEvent({ kind: 'finalLap', kartId: 0 }, [0]);
    dir.raceEvent({ kind: 'finalLap', kartId: 1 }, [0]);
    expect(played).toEqual(['final_lap']);
    played.length = 0;
    dir.raceEvent({ kind: 'finish', kartId: 1, place: 1 }, [0]);
    dir.raceEvent({ kind: 'finish', kartId: 0, place: 2 }, [0]);
    expect(played).toEqual(['race_finish']);
  });

  test('results does not play anything', () => {
    dir.raceEvent({ kind: 'results' }, [0]);
    expect(played).toEqual([]);
  });
});

describe('frame', () => {
  test('powerup sounds play in order', () => {
    sfx = ['boost', 'mine_drop'];
    dir.frame(source, 0);
    expect(played).toEqual(['boost', 'mine_drop']);
  });

  test('wall bumps are throttled to one per kart per 0.3 s', () => {
    walls = [0, 0, 1];
    dir.frame(source, 1000);
    expect(played).toEqual(['wall_bump', 'wall_bump']); // kart 0 once, kart 1 once
    walls = [0];
    dir.frame(source, 1200);
    expect(played).toHaveLength(2);
    walls = [0];
    dir.frame(source, 1300);
    expect(played).toHaveLength(3);
  });

  test('a kart bump plays once for the pair, then is throttled per kart', () => {
    bumps = [0, 1];
    dir.frame(source, 1000);
    expect(played).toEqual(['kart_bump']);
    bumps = [0, 1, 0, 1]; // two bumps in one frame
    dir.frame(source, 1100);
    expect(played).toEqual(['kart_bump']);
    bumps = [0, 2]; // kart 2 is new
    dir.frame(source, 1200);
    expect(played).toEqual(['kart_bump', 'kart_bump']);
    bumps = [0, 1];
    dir.frame(source, 1350); // kart 0's window (opened at 1200) is still closed, but kart 1's reopened at 1000+300 < 1350
    expect(played).toHaveLength(3);
  });

  test('wall and kart bump throttles are separate', () => {
    walls = [0];
    bumps = [0, 1];
    dir.frame(source, 0);
    expect(played).toEqual(['wall_bump', 'kart_bump']);
  });

  test('music follows the phase and is only asked for once per change', () => {
    for (const [p, expected] of [
      ['lobby', 'music_lobby'],
      ['countdown', 'music_race'],
      ['racing', 'music_race'],
      ['results', 'music_lobby'],
    ] as const) {
      phase = p;
      dir.frame(source, 0);
      expect(musicCalls[musicCalls.length - 1]).toBe(expected);
    }
    const n = musicCalls.length;
    dir.frame(source, 16);
    dir.frame(source, 32);
    expect(musicCalls).toHaveLength(n); // no repeats within a phase group
  });

  test('lobby music then countdown music then racing: one switch each', () => {
    phase = 'lobby';
    dir.frame(source, 0);
    phase = 'countdown';
    dir.frame(source, 1);
    phase = 'racing';
    dir.frame(source, 2);
    expect(musicCalls).toEqual(['music_lobby', 'music_race']);
  });

  test('engine plays only while racing, at the average speed', () => {
    speeds = [MAX_SPEED, 0];
    phase = 'countdown';
    dir.frame(source, 0);
    expect(engineCalls).toEqual([null]);
    phase = 'racing';
    dir.frame(source, 16);
    expect(engineCalls[1]).toBeCloseTo(0.5);
    speeds = [MAX_SPEED, MAX_SPEED];
    dir.frame(source, 32);
    expect(engineCalls[2]).toBeCloseTo(1);
    phase = 'results';
    dir.frame(source, 48);
    expect(engineCalls[3]).toBeNull();
  });

  test('reversing karts count by their speed, and no karts means idle', () => {
    speeds = [-MAX_SPEED / 2, MAX_SPEED / 2];
    dir.frame(source, 0);
    expect(engineCalls[0]).toBeCloseTo(0.5);
    speeds = [];
    dir.frame(source, 16);
    expect(engineCalls[1]).toBe(0);
  });
});

test('playerJoined plays player_join', () => {
  dir.playerJoined();
  expect(played).toEqual(['player_join']);
});
