import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
// Side effect: registers `Mesh.createInstance` (a type-only import would be erased).
import '@babylonjs/core/Meshes/instancedMesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Track } from '../track/track';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { KART_COLORS } from '@rc/shared';
import { ENV, SUN_DIR, WIND_X, WIND_Z, cloudMaterial, cloudShadowMaterial, pondMaterial, toonMaterial } from './shaders';

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

/** Distance (m) from (x, z) to the track's centre line. */
export function centreDistance(track: Track, x: number, z: number): number {
  return Math.abs(track.project({ x, z }).lateral);
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

// ----- pond -----

/** A small pond in the big infield beside the start straight: water radius (m) and its sandy shore. */
export const POND = { x: 22, z: 6, r: 5 };
export const POND_SHORE = 1.7;

/** The pond: one alpha-blended disc drawn by the pond shader (water, shore ring, soft edge). */
export function buildPond(scene: Scene): void {
  const pond = CreateDisc('pond', { radius: POND.r * 1.11 + POND_SHORE, tessellation: 40 }, scene);
  pond.rotation.x = Math.PI / 2;
  pond.position.set(POND.x, 0.03, POND.z);
  const mat = pondMaterial(POND.x, POND.z, POND.r, scene);
  mat.zOffset = -1;
  pond.material = mat;
  pond.isPickable = false;
  pond.freezeWorldMatrix();
  pond.doNotSyncBoundingInfo = true;
}

// ----- clouds -----

const CLOUD_COUNT = 9;
const CLOUD_SEED = 7;
/** Clouds drift inside the track bounds grown by this much, and wrap around at its edges. */
const CLOUD_MARGIN = 70;
/** Cloud heights (m): low enough to be seen from the steep camera at every zoom, like a diorama. */
const CLOUD_MIN_Y = 7;
const CLOUD_MAX_Y = 10;
/** Drift speed along the wind (m/s). */
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
 * The bottom of the screen is the near ground, so clouds there would be big blobs: they go too.
 */
export function screenFade(sx: number, sy: number): number {
  const e = Math.hypot(sx / 0.62, sy / 0.95);
  const t = Math.max(0, Math.min(1, (e - 0.85) / 0.3));
  const low = Math.max(0, Math.min(1, (-sy - 0.3) / 0.3));
  return t * t * (3 - 2 * t) * (1 - low * low * (3 - 2 * low));
}

/**
 * 0 for a cloud nearer the camera than 30 m (`depth`: its view depth), 1 beyond 45 m: closer than
 * that a cloud would fill a big part of the screen, so up close they only peek in at the top.
 */
export function nearFade(depth: number): number {
  const t = Math.max(0, Math.min(1, (depth - 30) / 15));
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
    const size = 0.95 + rand() * 0.35;
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
      // Clouds out at the edges of the view stay; ones over its middle or right by the lens shrink away.
      const seen = w > 0 ? screenFade(sx, sy) * nearFade(w) : 0;
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

// ----- decorations: placement (pure, so the clearance rules are testable) -----

/** Start/finish arch posts stand this far either side of the centre line (the walls end at ~7.1 m). */
const ARCH_LATERAL = 7.9;
const ARCH_HEIGHT = 5.6;
const BANNER_HEIGHT = 1.95;
/** Bunting: poles left of the start straight at these distances past the line (m), outside the wall. */
const BUNTING_S = [14, 32, 50, 68];
const BUNTING_LATERAL = -8.8;
const POLE_HEIGHT = 4.2;
/** Fences on the outside (left) of the far hairpin and the last corner: s ranges (m) and lateral. */
const FENCE_RANGES: readonly (readonly [number, number])[] = [[112, 200], [352, 404]];
const FENCE_LATERAL = -8.6;
const FENCE_STEP = 2.4;
const FLOWER_PATCHES = 26;
const BUSHES = 14;
const DECOR_SEED = 4242;

/** The two arch posts, right and left of the start line, and the road heading there. */
export function archLayout(track: Track): { posts: { x: number; z: number }[]; heading: number } {
  return { posts: [track.pointAt(0, ARCH_LATERAL), track.pointAt(0, -ARCH_LATERAL)], heading: track.headingAt(0) };
}

/** Bunting poles along the start straight, outside the left wall. */
export function buntingLayout(track: Track): { x: number; z: number }[] {
  return BUNTING_S.map((s) => track.pointAt(s, BUNTING_LATERAL));
}

/**
 * Fence posts every FENCE_STEP metres along the fence line, in runs (rails join neighbours in a run).
 * A post that would come near another bit of road is left out, which splits its run.
 */
export function fenceLayout(track: Track): { x: number; z: number }[][] {
  const runs: { x: number; z: number }[][] = [];
  for (const [from, to] of FENCE_RANGES) {
    let run: { x: number; z: number }[] = [];
    let prev = track.pointAt(from, FENCE_LATERAL);
    let walked = FENCE_STEP;
    for (let s = from; s <= to; s += 0.25) {
      const p = track.pointAt(s, FENCE_LATERAL);
      walked += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
      if (walked < FENCE_STEP) continue;
      walked = 0;
      if (centreDistance(track, p.x, p.z) >= track.width / 2 + 2) run.push(p);
      else if (run.length > 0) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length > 0) runs.push(run);
  }
  return runs;
}

/** Room the fixed decorations need, so trees, rocks, flowers and bushes keep out of it. */
export function fixedBlockers(track: Track): Circle[] {
  const out: Circle[] = [{ x: POND.x, z: POND.z, r: POND.r * 1.11 + POND_SHORE }];
  for (const p of archLayout(track).posts) out.push({ x: p.x, z: p.z, r: 1 });
  // Along the bunting string, every few metres.
  for (let s = BUNTING_S[0]; s <= BUNTING_S[BUNTING_S.length - 1]; s += 3) {
    const p = track.pointAt(s, BUNTING_LATERAL);
    out.push({ x: p.x, z: p.z, r: 1.2 });
  }
  for (const run of fenceLayout(track)) for (const p of run) out.push({ x: p.x, z: p.z, r: 1 });
  return out;
}

/**
 * Flower patches (r: patch radius) and bushes, scattered over the visible meadow like the trees: off
 * the road and out past the walls, clear of the pond, the trees and everything else in `blocked`.
 */
export function scatterLayout(track: Track, blocked: readonly Circle[]): { flowers: Circle[]; bushes: Circle[] } {
  const rand = seeded(DECOR_SEED);
  const b = track.bounds;
  const pad = 22;
  const taken = blocked.slice();
  const pick = (count: number, rMin: number, rMax: number): Circle[] => {
    const out: Circle[] = [];
    for (let tries = 0; out.length < count && tries < 3000; tries++) {
      const x = b.minX - pad + rand() * (b.maxX - b.minX + 2 * pad);
      const z = b.minZ - pad + rand() * (b.maxZ - b.minZ + 2 * pad);
      const r = rMin + rand() * (rMax - rMin);
      if (centreDistance(track, x, z) < track.width / 2 + 2.5 + r) continue;
      if (taken.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r + 0.8)) continue;
      const c = { x, z, r };
      out.push(c);
      taken.push(c);
    }
    return out;
  };
  return { flowers: pick(FLOWER_PATCHES, 1.1, 1.8), bushes: pick(BUSHES, 0.9, 1.4) };
}

// ----- decorations: meshes -----

const WOOD = Color3.FromHexString('#D2AC84');
const CREAM = Color3.FromHexString('#FFF3E0');
const CORAL = Color3.FromHexString('#FF8A80');
const BUSH = Color3.FromHexString('#7FCB95');
const LEAF = Color3.FromHexString('#9ED9A8');
const FLOWER_COLORS = ['#FFB3C7', '#FFE38A', '#C9B6F2', '#FFF7EE', '#FFC09F', '#A9D8FF'].map((h) => Color3.FromHexString(h));

/** A copy of `src` placed by `m`, painted `color`, ready to merge (uvs dropped so every part matches). */
function part(src: VertexData, color: Color3, m: Matrix): VertexData {
  const d = new VertexData();
  d.positions = (src.positions as number[]).slice();
  d.normals = (src.normals as number[]).slice();
  d.indices = (src.indices as number[]).slice();
  d.transform(m);
  const n = d.positions.length / 3;
  const colors = new Array<number>(n * 4);
  for (let i = 0; i < n; i++) {
    colors[i * 4] = color.r;
    colors[i * 4 + 1] = color.g;
    colors[i * 4 + 2] = color.b;
    colors[i * 4 + 3] = 1;
  }
  d.colors = colors;
  return d;
}

const place = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): Matrix =>
  Matrix.Compose(new Vector3(sx, sy, sz), Quaternion.RotationYawPitchRoll(ry, 0, 0), new Vector3(x, y, z));

/** One static, frozen mesh from many coloured parts: a single draw call. */
function bake(name: string, parts: VertexData[], scene: Scene): Mesh {
  const all = parts[0];
  if (parts.length > 1) all.merge(parts.slice(1), true);
  const mesh = new Mesh(name, scene);
  all.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  mesh.doNotSyncBoundingInfo = true;
  return mesh;
}

/** The arch's banner: checkered stripes top and bottom and "Racing Carts", drawn once. */
function bannerTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture('banner', { width: 1024, height: 128 }, scene, true);
  const draw = (): void => {
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = '#FFF3E0';
    ctx.fillRect(0, 0, 1024, 128);
    // Two rows of checks along the top and the bottom edge.
    const sq = 16;
    for (let col = 0; col < 1024 / sq; col++)
      for (const row of [0, 1, 6, 7]) {
        ctx.fillStyle = (col + row) % 2 === 0 ? '#5B4638' : '#FFF3E0';
        ctx.fillRect(col * sq, row * sq, sq, sq);
      }
    ctx.font = '900 60px Nunito, ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FF7A70';
    ctx.fillText('Racing Carts', 512, 66);
    tex.update();
  };
  draw();
  // The rounded font may still be loading at boot: redraw once when it is in.
  if (typeof document !== 'undefined' && document.fonts) void document.fonts.ready.then(draw);
  return tex;
}

/** Start/finish arch: two cream posts with coral caps and the checkered banner across the road. */
function buildArch(track: Track, solid: VertexData[], scene: Scene): void {
  const { posts, heading } = archLayout(track);
  const post = VertexData.CreateCylinder({ height: ARCH_HEIGHT, diameter: 0.55, tessellation: 10 });
  const cap = VertexData.CreateSphere({ diameter: 0.95, segments: 6 });
  for (const p of posts) {
    solid.push(part(post, CREAM, place(p.x, ARCH_HEIGHT / 2, p.z)));
    solid.push(part(cap, CORAL, place(p.x, ARCH_HEIGHT + 0.25, p.z)));
  }
  const banner = CreatePlane('banner', { width: ARCH_LATERAL * 2, height: BANNER_HEIGHT }, scene);
  // Faces the karts coming up to the line (and the camera), leaning back a touch to be read from above.
  banner.position.set((posts[0].x + posts[1].x) / 2, ARCH_HEIGHT - BANNER_HEIGHT / 2 - 0.15, (posts[0].z + posts[1].z) / 2);
  banner.rotation.set(0.3, heading, 0);
  const mat = new StandardMaterial('banner', scene);
  mat.disableLighting = true;
  mat.emissiveTexture = bannerTexture(scene);
  mat.freeze();
  banner.material = mat;
  banner.isPickable = false;
  banner.freezeWorldMatrix();
}

/** Bunting: wooden poles with a sagging string of kart-coloured pennants (double-sided). */
function buildBunting(track: Track, scene: Scene): void {
  const poles = buntingLayout(track);
  const parts: VertexData[] = [];
  const pole = VertexData.CreateCylinder({ height: POLE_HEIGHT, diameter: 0.22, tessellation: 6 });
  const knob = VertexData.CreateSphere({ diameter: 0.4, segments: 4 });
  for (const p of poles) {
    parts.push(part(pole, WOOD, place(p.x, POLE_HEIGHT / 2, p.z)));
    parts.push(part(knob, CORAL, place(p.x, POLE_HEIGHT + 0.1, p.z)));
  }
  const flag = new VertexData();
  // A pennant hanging from its top edge, in its local x-y plane.
  flag.positions = [-0.38, 0, 0, 0.38, 0, 0, 0, -0.85, 0];
  flag.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1];
  flag.indices = [0, 1, 2];
  const cord = VertexData.CreateBox({ width: 0.05, height: 0.05, depth: 1 });
  let k = 0;
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = poles[i], b = poles[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const top = POLE_HEIGHT - 0.2;
    const steps = Math.round(len / 1.1);
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const y = top - 1.1 * 4 * t * (1 - t); // gentle sag
      if (j < steps) {
        // The cord to the next point.
        const t2 = (j + 1) / steps;
        const y2 = top - 1.1 * 4 * t2 * (1 - t2);
        const seg = len / steps;
        const m = Matrix.Compose(
          new Vector3(1, 1, Math.hypot(seg, y2 - y)),
          Quaternion.RotationYawPitchRoll(yaw, Math.atan2(y - y2, seg), 0),
          new Vector3(x + ((b.x - a.x) / steps) / 2, (y + y2) / 2, z + ((b.z - a.z) / steps) / 2),
        );
        parts.push(part(cord, CREAM, m));
      }
      if (j > 0 && j < steps) {
        // Turned partway towards the camera (which looks along +z), so they read as flags, not slivers.
        parts.push(part(flag, Color3.FromHexString(KART_COLORS[k++ % KART_COLORS.length]), place(x, y, z, 1, 1, 1, yaw - 1.1)));
      }
    }
  }
  const mat = toonMaterial('bunting', '#FFFFFF', scene);
  mat.backFaceCulling = false;
  bake('bunting', parts, scene).material = mat;
}

/** Low wooden fence along the outside of two corners: posts and two rails. */
function buildFences(track: Track, solid: VertexData[]): void {
  const post = VertexData.CreateBox({ width: 0.2, height: 1, depth: 0.2 });
  const rail = VertexData.CreateBox({ width: 0.08, height: 0.12, depth: 1 });
  for (const run of fenceLayout(track)) {
    for (let i = 0; i < run.length; i++) {
      const p = run[i];
      solid.push(part(post, WOOD, place(p.x, 0.5, p.z)));
      const q = run[i + 1];
      if (!q) continue;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const yaw = Math.atan2(q.x - p.x, q.z - p.z);
      for (const y of [0.45, 0.78]) solid.push(part(rail, WOOD, place((p.x + q.x) / 2, y, (p.z + q.z) / 2, 1, 1, len, yaw)));
    }
  }
}

/** Flower patches (pastel blobs on a few leaves) and round bushes. */
function buildFlowersAndBushes(track: Track, blocked: readonly Circle[], solid: VertexData[]): void {
  const { flowers, bushes } = scatterLayout(track, blocked);
  const rand = seeded(DECOR_SEED + 1);
  const blob = VertexData.CreateIcoSphere({ radius: 1, subdivisions: 1, flat: false });
  const puff = VertexData.CreateSphere({ diameter: 2, segments: 5 });
  for (const patch of flowers) {
    const n = 6 + Math.floor(rand() * 5);
    const tint = FLOWER_COLORS[Math.floor(rand() * FLOWER_COLORS.length)];
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * patch.r;
      const x = patch.x + Math.cos(a) * d, z = patch.z + Math.sin(a) * d;
      // Mostly the patch's colour, now and then a different one.
      const c = rand() < 0.75 ? tint : FLOWER_COLORS[Math.floor(rand() * FLOWER_COLORS.length)];
      solid.push(part(blob, LEAF, place(x, 0.08, z, 0.32, 0.12, 0.32)));
      solid.push(part(blob, c, place(x, 0.32, z, 0.25, 0.17, 0.25)));
    }
  }
  for (const bush of bushes) {
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, d = i === 0 ? 0 : bush.r * 0.55;
      const s = bush.r * (i === 0 ? 0.85 : 0.6);
      solid.push(part(puff, BUSH, place(bush.x + Math.cos(a) * d, s * 0.55, bush.z + Math.sin(a) * d, s, s * 0.8, s)));
    }
  }
}

/**
 * All decorations: the start arch, bunting along the start straight, fences on two corners, flowers
 * and bushes. `blocked` is the room the trees and rocks already take. The solid parts are baked into
 * one toon mesh; the banner and the bunting are a mesh each.
 */
export function buildDecorations(scene: Scene, track: Track, blocked: readonly Circle[]): void {
  const solid: VertexData[] = [];
  buildArch(track, solid, scene);
  buildFences(track, solid);
  buildFlowersAndBushes(track, blocked, solid);
  bake('decor', solid, scene).material = toonMaterial('decor', '#FFFFFF', scene);
  buildBunting(track, scene);
}
