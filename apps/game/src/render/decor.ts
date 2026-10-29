import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
// Side effect: registers `Mesh.createInstance` (a type-only import would be erased).
import '@babylonjs/core/Meshes/instancedMesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Track } from '../track/track';
import { ENV, SUN_DIR, cloudMaterial, cloudShadowMaterial } from './shaders';

/** Small deterministic PRNG (mulberry32), so the world is the same every boot. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----- clouds -----

const CLOUD_COUNT = 9;
const CLOUD_SEED = 7;
/** Clouds drift inside the track bounds grown by this much, and wrap around at its edges. */
const CLOUD_MARGIN = 70;
/** Cloud heights (m): low enough to be seen from the steep camera at every zoom, like a diorama. */
const CLOUD_MIN_Y = 10;
const CLOUD_MAX_Y = 14;
/** Wind (unit xz direction) and drift speed (m/s). */
const WIND_X = 0.96;
const WIND_Z = 0.28;
const WIND_SPEED = 1.1;
/** Near the wrap edges a cloud shrinks away (and grows back on the other side) over this many metres. */
const CLOUD_EDGE = 30;

export interface Area {
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
}

/** `v` wrapped into [min, min + size). */
export function wrapInto(v: number, min: number, size: number): number {
  return min + ((((v - min) % size) + size) % size);
}

/** 0 on the area's edge, rising smoothly to 1 at `band` metres inside it (a cloud's size there). */
export function edgeFade(x: number, z: number, area: Area, band: number): number {
  const d = Math.min(x - area.minX, area.minX + area.sizeX - x, z - area.minZ, area.minZ + area.sizeZ - z);
  const t = Math.max(0, Math.min(1, d / band));
  return t * t * (3 - 2 * t);
}

/**
 * 1 for a cloud whose centre is out near the screen edges, shrinking to 0 over the middle of the view
 * (screen coordinates in [-1, 1]), where the camera frames the karts: clouds never hide the race.
 */
export function screenFade(sx: number, sy: number): number {
  const e = Math.hypot(sx / 0.62, sy / 0.85);
  const t = Math.max(0, Math.min(1, (e - 0.85) / 0.3));
  return t * t * (3 - 2 * t);
}

/** Where a cloud that started at (x0, z0) is after `time` seconds of wind, wrapped into the area. */
export function cloudAt(x0: number, z0: number, time: number, area: Area, out: { x: number; z: number }): void {
  out.x = wrapInto(x0 + WIND_X * WIND_SPEED * time, area.minX, area.sizeX);
  out.z = wrapInto(z0 + WIND_Z * WIND_SPEED * time, area.minZ, area.sizeZ);
}

/** A cloud: 3-6 low-poly puffs along the wind, merged, with a flattened underside. */
function cloudMesh(i: number, rand: () => number, scene: Scene): Mesh {
  const puffs: Mesh[] = [];
  const n = 3 + Math.floor(rand() * 4);
  for (let k = 0; k < n; k++) {
    // Overlapping puffs along the wind, biggest in the middle, with a little sideways jitter.
    const u = k - (n - 1) / 2;
    const d = (6.5 - Math.abs(u) * 1.1) * (0.85 + rand() * 0.3);
    const puff = CreateSphere('puff', { diameter: d, segments: 4 }, scene);
    puff.position.set(u * 2.7, d * 0.15, (rand() - 0.5) * 2);
    puffs.push(puff);
  }
  const cloud = Mesh.MergeMeshes(puffs, true) as Mesh;
  cloud.name = 'cloud' + i;
  // Flat-bottomed and a little squashed, like a cumulus; then turned to face along the wind.
  const pos = cloud.getVerticesData(VertexBuffer.PositionKind) as number[];
  for (let v = 1; v < pos.length; v += 3) pos[v] = pos[v] < 0 ? pos[v] * 0.25 : pos[v] * 0.8;
  cloud.updateVerticesData(VertexBuffer.PositionKind, pos);
  cloud.rotation.y = Math.atan2(-WIND_Z, WIND_X);
  cloud.isPickable = false;
  return cloud;
}

/** 8-10 clouds drifting with the wind over the play area, each with a soft shadow on the ground. */
export function buildClouds(scene: Scene, track: Track): void {
  const b = track.bounds;
  const area: Area = {
    minX: b.minX - CLOUD_MARGIN,
    minZ: b.minZ - CLOUD_MARGIN,
    sizeX: b.maxX - b.minX + 2 * CLOUD_MARGIN,
    sizeZ: b.maxZ - b.minZ + 2 * CLOUD_MARGIN,
  };
  const rand = seeded(CLOUD_SEED);
  const mat = cloudMaterial(scene);
  const shadowSource = CreateGround('cloudShadow', { width: 1, height: 1 }, scene);
  shadowSource.material = cloudShadowMaterial(scene);
  shadowSource.isPickable = false;
  shadowSource.isVisible = false;
  // Sun rays slant, so a shadow lies this far from the point under its cloud, per metre of height.
  const slantX = -SUN_DIR.x / SUN_DIR.y, slantZ = -SUN_DIR.z / SUN_DIR.y;

  const clouds: { mesh: Mesh; shadow: InstancedMesh; x0: number; z0: number; y: number; size: number }[] = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const mesh = cloudMesh(i, rand, scene);
    mesh.material = mat;
    const size = 1.2 + rand() * 0.5;
    const shadow = shadowSource.createInstance('cloudShadow' + i);
    shadow.isPickable = false;
    clouds.push({
      mesh,
      shadow,
      // Spread evenly across the area in a jittered 3 × 3 grid, so they never bunch up.
      x0: area.minX + ((i % 3) + 0.2 + rand() * 0.6) * (area.sizeX / 3),
      z0: area.minZ + (Math.floor(i / 3) + 0.2 + rand() * 0.6) * (area.sizeZ / 3),
      y: CLOUD_MIN_Y + rand() * (CLOUD_MAX_Y - CLOUD_MIN_Y),
      size,
    });
  }

  const at = { x: 0, z: 0 };
  const sync = (): void => {
    // Last frame's view-projection (column vectors in m[0..15]): where each cloud centre is on screen.
    const m = scene.getTransformMatrix().m;
    for (const c of clouds) {
      cloudAt(c.x0, c.z0, ENV.x, area, at);
      const s = c.size * edgeFade(at.x, at.z, area, CLOUD_EDGE);
      const w = at.x * m[3] + c.y * m[7] + at.z * m[11] + m[15];
      const sx = (at.x * m[0] + c.y * m[4] + at.z * m[8] + m[12]) / w;
      const sy = (at.x * m[1] + c.y * m[5] + at.z * m[9] + m[13]) / w;
      const seen = w > 0 ? screenFade(sx, sy) : 1;
      c.mesh.position.set(at.x, c.y, at.z);
      c.mesh.scaling.setAll(s * seen);
      c.mesh.setEnabled(s * seen > 0.01);
      // The shadow stays: a soft patch of shade drifting over the road is lovely and hides nothing.
      c.shadow.position.set(at.x + slantX * c.y, 0.08, at.z + slantZ * c.y);
      c.shadow.scaling.set(20 * s, 1, 13 * s);
    }
  };
  sync();
  scene.onBeforeRenderObservable.add(sync);
}
