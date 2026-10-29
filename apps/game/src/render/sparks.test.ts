import { afterAll, describe, expect, test } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { KART_COLORS } from '@rc/shared';
import { createKart } from '../kart/kart';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { SPARK_CAPACITY, SparkPool, SparkViews, type SparkColor } from './sparks';

const track = buildTrack(TRACK_V1);
const engine = new NullEngine({ renderWidth: 640, renderHeight: 360, textureSize: 256, deterministicLockstep: false, lockstepMaxSteps: 1 });
afterAll(() => engine.dispose());

describe('SparkPool', () => {
  test('a spark flies with its velocity, shrinks over its life and is gone after it', () => {
    const pool = new SparkPool();
    pool.emit(1, 0.5, 2, 4, 0, -2, 'yellow', 0.4);
    expect(pool.alive()).toBe(1);
    pool.step(0.1);
    expect(pool.x[0]).toBeCloseTo(1.4, 9);
    expect(pool.z[0]).toBeCloseTo(1.8, 9);
    expect(pool.scale(0)).toBeCloseTo(0.75, 9);
    pool.step(0.31);
    expect(pool.alive()).toBe(0);
    expect(pool.scale(0)).toBe(0);
  });

  test(`at most ${SPARK_CAPACITY} sparks: a full pool recycles the oldest`, () => {
    expect(SPARK_CAPACITY).toBe(32);
    const pool = new SparkPool();
    for (let i = 0; i < 40; i++) {
      pool.emit(i, 0.3, 0, 0, 0, 0, 'pink', 0.5);
      pool.step(0.001);
    }
    expect(pool.alive()).toBe(32);
    let oldest = Infinity;
    for (let i = 0; i < SPARK_CAPACITY; i++) oldest = Math.min(oldest, pool.x[i]);
    expect(oldest).toBe(8); // sparks 0..7 were replaced
  });

  test('sparks fall under a little gravity but never sink into the road', () => {
    const pool = new SparkPool();
    pool.emit(0, 0.3, 0, 0, 3, 0, 'cream', 0.5);
    let top = 0;
    for (let i = 0; i < 29; i++) {
      pool.step(1 / 60);
      top = Math.max(top, pool.y[0]);
      expect(pool.y[0]).toBeGreaterThan(0);
    }
    expect(top).toBeGreaterThan(0.5);
  });
});

describe('SparkViews', () => {
  function enabledByColor(views: SparkViews): Record<SparkColor, number> {
    return views.enabledCounts();
  }

  test('a drifting kart sprays sparks from its rear wheels: yellow at level 1, pink at level 2', () => {
    const scene = new Scene(engine);
    const views = new SparkViews(scene);
    const k = createKart(0, KART_COLORS[0], track.grid[0], track);
    k.speed = 15;
    k.drift = { active: true, charge: 0.7 };
    for (let i = 0; i < 6; i++) views.update([k], [], 1 / 60);
    expect(enabledByColor(views).yellow).toBeGreaterThan(0);
    expect(enabledByColor(views).pink).toBe(0);
    k.drift.charge = 1.4;
    for (let i = 0; i < 40; i++) views.update([k], [], 1 / 60); // the yellow ones burn out
    expect(enabledByColor(views).pink).toBeGreaterThan(0);
    expect(enabledByColor(views).yellow).toBe(0);
    k.drift = { active: false, charge: 0 };
    for (let i = 0; i < 40; i++) views.update([k], [], 1 / 60);
    expect(views.pool.alive()).toBe(0);
    scene.dispose();
  });

  test('a wall hit throws a small burst of cream sparks at that kart', () => {
    const scene = new Scene(engine);
    const views = new SparkViews(scene);
    const k = createKart(3, KART_COLORS[3], track.grid[3], track);
    views.update([k], [3], 1 / 60);
    const n = enabledByColor(views).cream;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(10);
    views.update([k], [42], 1 / 60); // a kart that is gone: nothing
    expect(enabledByColor(views).cream).toBe(n);
    scene.dispose();
  });

  test('no meshes are created after construction, however many sparks fly', () => {
    const scene = new Scene(engine);
    const views = new SparkViews(scene);
    const k = createKart(0, KART_COLORS[0], track.grid[0], track);
    k.speed = 15;
    k.drift = { active: true, charge: 1.5 };
    const meshes = scene.meshes.length;
    for (let i = 0; i < 300; i++) views.update([k], i % 7 === 0 ? [0] : [], 1 / 60);
    expect(scene.meshes.length).toBe(meshes);
    scene.dispose();
  });
});
