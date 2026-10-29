import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
// Side effect: registers `Mesh.createInstance` (a type-only import would be erased).
import '@babylonjs/core/Meshes/instancedMesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { driftLevel, type Kart } from '../kart/kart';
import { KART_RADIUS } from '../kart/tuning';
import type { Track } from '../track/track';
import { VISUAL_SCALE, WHEEL_X, WHEEL_Z } from './kartViews';

/** How many sparks can fly at once; a full pool recycles the spark closest to burning out. */
export const SPARK_CAPACITY = 32;

export type SparkColor = 'cream' | 'yellow' | 'pink';
const COLORS: readonly SparkColor[] = ['cream', 'yellow', 'pink'];
/** Soft pastel glow per colour: wall scrapes and a fresh drift are cream, charged drifts butter, then pink. */
const HEX: Record<SparkColor, string> = { cream: '#FFD9B0', yellow: '#FFD66B', pink: '#FF9CC2' };

const GRAVITY = 9;
const FLOOR = 0.05;
const SPARK_SIZE = 0.5;
/** Share of its size a spark keeps at the very end, so it fades to a speck rather than vanishing early. */
const END_SIZE = 0.35;
/** Drift sparks per second per kart at charge level 0, 1, 2 (level 0 is a light dust that says "drifting"). */
const DRIFT_RATE = [10, 36, 48];
const DRIFT_COLOR: readonly SparkColor[] = ['cream', 'yellow', 'pink'];
const WALL_BURST = 6;

/** Fixed-size particle store in flat arrays: no allocation once built. */
export class SparkPool {
  readonly x = new Float64Array(SPARK_CAPACITY);
  readonly y = new Float64Array(SPARK_CAPACITY);
  readonly z = new Float64Array(SPARK_CAPACITY);
  private vx = new Float64Array(SPARK_CAPACITY);
  private vy = new Float64Array(SPARK_CAPACITY);
  private vz = new Float64Array(SPARK_CAPACITY);
  /** Seconds left (0 = free slot) and the lifetime it started with. */
  private life = new Float64Array(SPARK_CAPACITY);
  private maxLife = new Float64Array(SPARK_CAPACITY);
  readonly color: SparkColor[] = new Array<SparkColor>(SPARK_CAPACITY).fill('cream');

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: SparkColor, life: number): void {
    // A free slot, or else the spark with the least life left.
    let slot = 0;
    for (let i = 0; i < SPARK_CAPACITY; i++) {
      if (this.life[i] <= 0) {
        slot = i;
        break;
      }
      if (this.life[i] < this.life[slot]) slot = i;
    }
    this.x[slot] = x;
    this.y[slot] = y;
    this.z[slot] = z;
    this.vx[slot] = vx;
    this.vy[slot] = vy;
    this.vz[slot] = vz;
    this.color[slot] = color;
    this.life[slot] = life;
    this.maxLife[slot] = life;
  }

  /** Simple flight: a little gravity, a road they bounce flat on, and a clock that runs out. */
  step(dt: number): void {
    for (let i = 0; i < SPARK_CAPACITY; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        continue;
      }
      this.vy[i] -= GRAVITY * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      if (this.y[i] < FLOOR) {
        this.y[i] = FLOOR;
        this.vy[i] = 0;
      }
    }
  }

  /** Size factor of spark `i`: 1 when born, shrinking to 0 as it burns out (0 for a free slot). */
  scale(i: number): number {
    return this.life[i] > 0 ? this.life[i] / this.maxLife[i] : 0;
  }

  alive(): number {
    let n = 0;
    for (let i = 0; i < SPARK_CAPACITY; i++) if (this.life[i] > 0) n++;
    return n;
  }
}

const rnd = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

/**
 * Tiny glowing pastel cubes: bursts where karts scrape walls, and a stream from the rear wheels of drifting
 * karts coloured by the drift charge. Every pool slot owns one instance per colour, made up front.
 */
export class SparkViews {
  readonly pool = new SparkPool();
  private instances: Record<SparkColor, InstancedMesh[]>;
  /** Fractional drift sparks owed per kart id, and which rear wheel throws the next one. */
  private owed: number[] = [];
  private wheel: number[] = [];

  /** With a `track`, wall sparks fly from the side of the kart that touched the wall. */
  constructor(scene: Scene, private readonly track?: Track) {
    const make = (color: SparkColor): InstancedMesh[] => {
      const source: Mesh = CreateBox('spark' + color, { size: SPARK_SIZE }, scene);
      const m = new StandardMaterial('spark' + color, scene);
      m.disableLighting = true;
      m.emissiveColor = Color3.FromHexString(HEX[color]);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.freeze();
      source.material = m;
      source.isPickable = false;
      source.isVisible = false; // only its instances are drawn
      const list: InstancedMesh[] = [];
      for (let i = 0; i < SPARK_CAPACITY; i++) {
        const inst = source.createInstance('spark' + color + i);
        inst.isPickable = false;
        inst.setEnabled(false);
        list.push(inst);
      }
      return list;
    };
    this.instances = { cream: make('cream'), yellow: make('yellow'), pink: make('pink') };
  }

  /** Emits for this frame (drifts, then the wall hits drained this frame), flies the sparks and syncs the cubes. */
  update(karts: readonly Kart[], wallHits: readonly number[], dt: number): void {
    for (const k of karts) this.emitDrift(k, dt);
    for (const id of wallHits) {
      for (const k of karts) if (k.id === id) this.emitWall(k);
    }
    const pool = this.pool;
    pool.step(dt);
    for (let i = 0; i < SPARK_CAPACITY; i++) {
      const s = pool.scale(i);
      for (const c of COLORS) {
        const inst = this.instances[c][i];
        const on = s > 0 && pool.color[i] === c;
        if (inst.isEnabled() !== on) inst.setEnabled(on);
        if (!on) continue;
        inst.position.set(pool.x[i], pool.y[i], pool.z[i]);
        inst.scaling.setAll(END_SIZE + (1 - END_SIZE) * s);
      }
    }
  }

  /** Only for tests: how many cubes of each colour are showing. */
  enabledCounts(): Record<SparkColor, number> {
    const out: Record<SparkColor, number> = { cream: 0, yellow: 0, pink: 0 };
    for (const c of COLORS) for (const inst of this.instances[c]) if (inst.isEnabled()) out[c]++;
    return out;
  }

  private emitDrift(k: Kart, dt: number): void {
    while (this.owed.length <= k.id) {
      this.owed.push(0);
      this.wheel.push(0);
    }
    if (!k.drift.active) {
      this.owed[k.id] = 0;
      return;
    }
    const level = driftLevel(k);
    this.owed[k.id] += DRIFT_RATE[level] * dt;
    const fx = Math.sin(k.heading), fz = Math.cos(k.heading);
    const rx = Math.cos(k.heading), rz = -Math.sin(k.heading);
    while (this.owed[k.id] >= 1) {
      this.owed[k.id] -= 1;
      const side = (this.wheel[k.id] = 1 - this.wheel[k.id]) === 1 ? 1 : -1;
      const lx = side * WHEEL_X * VISUAL_SCALE, lz = -WHEEL_Z * VISUAL_SCALE;
      const out = rnd(0.8, 2), back = rnd(1.5, 3);
      this.pool.emit(
        k.pos.x + rx * lx + fx * lz,
        0.2,
        k.pos.z + rz * lx + fz * lz,
        k.vel.x * 0.4 + rx * side * out - fx * back,
        rnd(1.5, 3),
        k.vel.z * 0.4 + rz * side * out - fz * back,
        DRIFT_COLOR[level],
        rnd(0.3, 0.5),
      );
    }
  }

  private emitWall(k: Kart): void {
    // Where the kart meets the wall, spraying back onto the road (a hit is rare: the projection may allocate).
    let wx = 0, wz = 0;
    if (this.track) {
      const pr = this.track.project(k.pos, k.trackIndex);
      const h = this.track.headingAt(pr.s);
      const side = pr.lateral >= 0 ? 1 : -1;
      wx = Math.cos(h) * side;
      wz = -Math.sin(h) * side;
    }
    const x = k.pos.x + wx * KART_RADIUS * 1.2, z = k.pos.z + wz * KART_RADIUS * 1.2;
    for (let i = 0; i < WALL_BURST; i++) {
      const a = Math.random() * Math.PI * 2, v = rnd(1, 2.5), away = rnd(3, 5);
      this.pool.emit(
        x,
        0.9,
        z,
        k.vel.x * 0.5 + Math.cos(a) * v - wx * away,
        rnd(2.5, 4),
        k.vel.z * 0.5 + Math.sin(a) * v - wz * away,
        'cream',
        rnd(0.3, 0.5),
      );
    }
  }
}
