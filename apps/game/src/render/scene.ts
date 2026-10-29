import type { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateRibbon } from '@babylonjs/core/Meshes/Builders/ribbonBuilder';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { PAD_LENGTH, PAD_WIDTH } from '../race/boostPads';
import type { Track } from '../track/track';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ENV, HORIZON, SUN_DIR, grassMaterial, noiseTexture, padMaterial, roadMaterial, skyMaterial, toonMaterial } from './shaders';
import { POND, POND_SHORE, buildClouds, buildPond, seeded } from './decor';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';

export const PALETTE = {
  grass: '#BFE6A6',
  road: '#C9C2BA',
  stripe: '#FFFFFF',
  dash: '#E6DFD6',
  wallA: '#FF8A80',
  wallB: '#FFF3E0',
  canopy: '#8FD6A0',
  trunk: '#C9A27E',
  rock: '#D9CFC1',
  shadow: '#4A3A30',
  padBase: '#FFEFC2',
  padArrow: '#FFC24D',
};

const WALL_RADIUS = 0.6;
const WALL_SEGMENT = 6;
/** Per side, so the grass plane is the track bounds + 60 m. */
const GROUND_MARGIN = 30;
const MEADOW_RADIUS = 1500;
const SCENERY_COUNT = 40;
/** Centre-line dashes: one every DASH_EVERY metres, DASH_LENGTH samples (~m) long. */
const DASH_EVERY = 8;
const DASH_LENGTH = 3;
const DASH_WIDTH = 0.5;
const GRID_CLEAR = 24;
const SCENERY_SEED = 20261029;

const HEMI_INTENSITY = 0.9;
const SUN_INTENSITY = 0.6;
/** Golden-afternoon light: a warm sun and a cooler sky fill (the hemisphere's ground side is warm). */
const SUN_COLOR = Color3.FromHexString('#FFE2B0');
const SKY_FILL = Color3.FromHexString('#E6EEFF');
const GROUND_FILL = Color3.FromHexString('#E6D6C4');
/**
 * The two lights together brighten up-facing surfaces by ~1.33×, which would wash pastels out to
 * yellow-white. Diffuse colours are pre-divided by the brightness of that light, so the tops of things
 * show the palette colour (a touch golden) and sides fall off into soft shading.
 */
const TOP_LIGHT = SKY_FILL.scale(HEMI_INTENSITY).add(SUN_COLOR.scale(SUN_INTENSITY * SUN_DIR.y));
const LIGHT_COMP = 1 / (0.3 * TOP_LIGHT.r + 0.59 * TOP_LIGHT.g + 0.11 * TOP_LIGHT.b);

/** Sky dome radius (m): inside the camera's far plane; it follows the camera. */
const SKY_RADIUS = 900;
/** Linear fog from FOG_START to FOG_END camera radii, so every zoom fades its far edge into the horizon. */
const FOG_START = 1.5;
const FOG_END = 4;

/** Share of each colour that glows regardless of light, so shaded sides stay soft pastel, not muddy. */
const SELF_LIT = 0.3;

/** Matte pastel material: no specular shine; `hex` is how an up-facing surface should look. */
export function matte(name: string, hex: string, scene: Scene): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c.scale((1 - SELF_LIT) * LIGHT_COMP);
  m.emissiveColor = c.scale(SELF_LIT);
  m.specularColor = new Color3(0.06, 0.06, 0.06);
  m.specularPower = 8;
  return m;
}

/** Dark translucent material for blob shadows. */
export function blobShadowMaterial(scene: Scene): StandardMaterial {
  const m = new StandardMaterial('blobShadow', scene);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveColor = Color3.FromHexString(PALETTE.shadow);
  m.disableLighting = true;
  m.alpha = 0.28;
  m.backFaceCulling = false;
  m.zOffset = -2;
  return m;
}

/** Freezes a static mesh so Babylon skips per-frame world-matrix and picking work. */
function settle(mesh: Mesh | null): void {
  if (!mesh) return;
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  mesh.doNotSyncBoundingInfo = true;
}

function merge(meshes: Mesh[], name: string): Mesh | null {
  if (meshes.length === 0) return null;
  const merged = Mesh.MergeMeshes(meshes, true, true);
  if (merged) {
    merged.name = name;
    settle(merged);
  }
  return merged;
}

/** Edge polyline at `lateral` metres right of the centre line, using smooth per-vertex headings. */
function edgePath(track: Track, lateral: number, y: number): Vector3[] {
  const n = track.points.length;
  const step = track.length / n;
  return track.points.map((p, i) => {
    const h = track.headingAt(i * step);
    return new Vector3(p.x + Math.cos(h) * lateral, y, p.z - Math.sin(h) * lateral);
  });
}

function buildGround(scene: Scene, track: Track, noise: Texture): void {
  const b = track.bounds;
  const ground = CreateGround(
    'ground',
    { width: b.maxX - b.minX + GROUND_MARGIN * 2, height: b.maxZ - b.minZ + GROUND_MARGIN * 2, subdivisions: 1 },
    scene,
  );
  ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  const m = grassMaterial(PALETTE.grass, noise, scene);
  ground.material = m;
  settle(ground);
  // The zoomed-out camera sees far past the play area; a wide meadow just below it in the same
  // colour keeps the world from ending in a floating rectangle against the sky.
  const meadow = CreateDisc('meadow', { radius: MEADOW_RADIUS, tessellation: 24 }, scene);
  meadow.rotation.x = Math.PI / 2;
  meadow.position.set(ground.position.x, -0.05, ground.position.z);
  meadow.material = m;
  settle(meadow);
}

function buildRoad(scene: Scene, track: Track, noise: Texture): void {
  const half = track.width / 2;
  // [left, right] gives upward-facing normals.
  const road = CreateRibbon(
    'road',
    { pathArray: [edgePath(track, -half, 0.02), edgePath(track, half, 0.02)], closePath: true },
    scene,
  );
  const roadMat = roadMaterial(PALETTE.road, noise, scene);
  roadMat.zOffset = -1;
  road.material = roadMat;
  settle(road);

  // Soft dashed centre line: cheap, and it makes speed readable on the long straights.
  const dashes: Mesh[] = [];
  const n = track.points.length;
  const per = Math.max(2, Math.round(DASH_EVERY / (track.length / n)));
  // Leave the start straight's grid boxes clean (grid rows reach ~18 m behind the line).
  for (let i = per; i + DASH_LENGTH < n - GRID_CLEAR; i += per) {
    const a = track.pointAt((i / n) * track.length, -DASH_WIDTH / 2);
    const b = track.pointAt(((i + DASH_LENGTH) / n) * track.length, -DASH_WIDTH / 2);
    const c = track.pointAt((i / n) * track.length, DASH_WIDTH / 2);
    const d = track.pointAt(((i + DASH_LENGTH) / n) * track.length, DASH_WIDTH / 2);
    dashes.push(
      CreateRibbon('dash', {
        pathArray: [
          [new Vector3(a.x, 0.03, a.z), new Vector3(b.x, 0.03, b.z)],
          [new Vector3(c.x, 0.03, c.z), new Vector3(d.x, 0.03, d.z)],
        ],
      }, scene),
    );
  }
  const dashMat = matte('dash', PALETTE.dash, scene);
  dashMat.zOffset = -2;
  const dashMesh = merge(dashes, 'centreDashes');
  if (dashMesh) dashMesh.material = dashMat;
  dashMat.freeze();

  // White start stripe across the road at s = 0, slightly shorter than the road is wide.
  const depth = 1.6;
  const stripe = CreateRibbon(
    'startStripe',
    {
      pathArray: [
        [track.pointAt(-depth / 2, -half + 0.3), track.pointAt(depth / 2, -half + 0.3)].map((p) => new Vector3(p.x, 0.04, p.z)),
        [track.pointAt(-depth / 2, half - 0.3), track.pointAt(depth / 2, half - 0.3)].map((p) => new Vector3(p.x, 0.04, p.z)),
      ],
    },
    scene,
  );
  const stripeMat = matte('stripe', PALETTE.stripe, scene);
  stripeMat.zOffset = -2;
  stripe.material = stripeMat;
  stripeMat.freeze();
  settle(stripe);
}

/** Chevron arrows on a pad: spacing along it (m), half-width, how far the arms sweep back, stroke depth. */
const CHEVRON_SPACING = 1.2;
const CHEVRON_HALF = 1.45;
const CHEVRON_SWEEP = 0.95;
const CHEVRON_DEPTH = 0.55;
/** The pale pad under the arrows is this much smaller than the contact rectangle, with clipped corners. */
const PAD_INSET = 0.15;
const PAD_CORNER = 0.6;

/** Flat polygons (fans from their first point) lying at height `y`, as one static mesh; points are [x, z, u, v]. */
function flatMesh(name: string, polygons: number[][][], y: number, scene: Scene): Mesh {
  const positions: number[] = [], indices: number[] = [], normals: number[] = [], uvs: number[] = [];
  for (const poly of polygons) {
    const base = positions.length / 3;
    for (const [x, z, u, v] of poly) {
      positions.push(x, y, z);
      normals.push(0, 1, 0);
      uvs.push(u, v);
    }
    for (let i = 1; i + 1 < poly.length; i++) indices.push(base, base + i, base + i + 1);
  }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  settle(mesh);
  return mesh;
}

/**
 * Boost pads: a pale butter pad (clipped corners) with warm-yellow chevrons that scroll down the road.
 * Each pad corner carries its (along, across) position in the pad's frame as uv for the shader.
 */
function buildBoostPads(scene: Scene, track: Track): void {
  if (track.boostPads.length === 0) return;
  const pads: number[][][] = [];
  for (const pad of track.boostPads) {
    const fx = Math.sin(pad.heading), fz = Math.cos(pad.heading);
    const rx = Math.cos(pad.heading), rz = -Math.sin(pad.heading);
    // (along, across) in the pad's frame → [world x, world z, along, across].
    const at = (a: number, l: number): number[] => [pad.pos.x + fx * a + rx * l, pad.pos.z + fz * a + rz * l, a, l];
    const ha = PAD_LENGTH / 2 - PAD_INSET, hl = PAD_WIDTH / 2 - PAD_INSET, c = PAD_CORNER;
    pads.push([at(0, 0), at(ha, -hl + c), at(ha, hl - c), at(ha - c, hl), at(-ha + c, hl), at(-ha, hl - c),
      at(-ha, -hl + c), at(-ha + c, -hl), at(ha - c, -hl), at(ha, -hl + c)]);
  }
  const mat = padMaterial(PALETTE.padBase, PALETTE.padArrow, {
    halfLength: PAD_LENGTH / 2 - PAD_INSET,
    halfWidth: CHEVRON_HALF,
    spacing: CHEVRON_SPACING,
    depth: CHEVRON_DEPTH / CHEVRON_SPACING,
    sweep: CHEVRON_SWEEP / CHEVRON_HALF,
  }, scene);
  mat.zOffset = -3;
  mat.backFaceCulling = false;
  flatMesh('boostPads', pads, 0.045, scene).material = mat;
}

/** Candy-striped tube walls just outside both road edges, merged into one mesh per colour. */
function buildWalls(scene: Scene, track: Track): void {
  const lateral = track.width / 2 + WALL_RADIUS * 0.8;
  const n = track.points.length;
  const per = Math.max(2, Math.round(WALL_SEGMENT / (track.length / n)));
  const segments = Math.max(2, Math.round(n / per));
  const groups: Mesh[][] = [[], []];
  for (const side of [-1, 1]) {
    const path = edgePath(track, side * lateral, WALL_RADIUS);
    for (let k = 0; k < segments; k++) {
      const from = Math.round((k * n) / segments);
      const to = Math.round(((k + 1) * n) / segments);
      const pts: Vector3[] = [];
      for (let i = from; i <= to; i++) pts.push(path[i % n]);
      groups[k % 2].push(
        CreateTube('wall', { path: pts, radius: WALL_RADIUS, tessellation: 8, cap: Mesh.NO_CAP }, scene),
      );
    }
  }
  const mats = [matte('wallA', PALETTE.wallA, scene), matte('wallB', PALETTE.wallB, scene)];
  groups.forEach((g, i) => {
    const mesh = merge(g, i === 0 ? 'wallsCoral' : 'wallsCream');
    if (mesh) mesh.material = mats[i];
    mats[i].freeze();
  });
}

/** Lollipop trees and rounded rocks scattered off the road, merged per material. */
function buildScenery(scene: Scene, track: Track): void {
  const rand = seeded(SCENERY_SEED);
  const b = track.bounds;
  const pad = GROUND_MARGIN - 4;
  const clear = track.width / 2 + 6;
  const placed: { x: number; z: number; r: number }[] = [{ x: POND.x, z: POND.z, r: POND.r + POND_SHORE }];
  const trunks: Mesh[] = [], canopies: Mesh[] = [], rocks: Mesh[] = [], shadows: Mesh[] = [];

  for (let tries = 0; placed.length < SCENERY_COUNT && tries < 4000; tries++) {
    const x = b.minX - pad + rand() * (b.maxX - b.minX + 2 * pad);
    const z = b.minZ - pad + rand() * (b.maxZ - b.minZ + 2 * pad);
    const isTree = rand() < 0.7;
    const size = 0.8 + rand() * 0.6;
    const r = (isTree ? 2.2 : 2) * size;
    if (Math.abs(track.project({ x, z }).lateral) < clear + r * 0.5) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 2)) continue;
    placed.push({ x, z, r });

    if (isTree) {
      const trunkH = 1.6 * size;
      const trunk = CreateCylinder('trunk', { height: trunkH, diameter: 0.6 * size, tessellation: 6 }, scene);
      trunk.position.set(x, trunkH / 2, z);
      trunks.push(trunk);
      const canopy = CreateSphere('canopy', { diameter: 4.2 * size, segments: 6 }, scene);
      canopy.position.set(x, trunkH + 1.6 * size, z);
      // For the sway shader: uv = (this tree's phase, the height where its foliage starts).
      const uv = canopy.getVerticesData(VertexBuffer.UVKind) as number[];
      for (let i = 0; i < uv.length; i += 2) {
        uv[i] = x * 0.37 + z * 0.23;
        uv[i + 1] = trunkH - 0.5 * size;
      }
      canopy.setVerticesData(VertexBuffer.UVKind, uv);
      canopies.push(canopy);
    } else {
      const rock = CreateIcoSphere('rock', { radius: 1.6 * size, subdivisions: 1, flat: true }, scene);
      rock.scaling.set(1.2, 0.7, 1);
      rock.rotation.y = rand() * Math.PI * 2;
      rock.position.set(x, 0.6 * size, z);
      rocks.push(rock);
    }
    const shadow = CreateDisc('shadow', { radius: r * 0.95, tessellation: 12 }, scene);
    shadow.rotation.x = Math.PI / 2;
    shadow.position.set(x, 0.03, z);
    shadows.push(shadow);
  }

  const set = (meshes: Mesh[], name: string, mat: Material) => {
    const m = merge(meshes, name);
    if (m) m.material = mat;
  };
  set(trunks, 'trunks', toonMaterial('trunk', PALETTE.trunk, scene, 0.08));
  set(canopies, 'canopies', toonMaterial('canopy', PALETTE.canopy, scene, 0.12, 'sway'));
  set(rocks, 'rocks', toonMaterial('rock', PALETTE.rock, scene, 0.1));
  const shadowMat = blobShadowMaterial(scene);
  set(shadows, 'sceneryShadows', shadowMat);
  shadowMat.freeze();
}

/** A large dome around the camera with the gradient sky; created first, so it is drawn first. */
function buildSky(scene: Scene): void {
  const sky = CreateSphere('sky', { diameter: SKY_RADIUS * 2, segments: 12 }, scene);
  sky.material = skyMaterial(scene);
  sky.infiniteDistance = true;
  sky.applyFog = false;
  sky.isPickable = false;
  sky.doNotSyncBoundingInfo = true;
  sky.alwaysSelectAsActiveMesh = true;
}

/** Builds the static world: sky, warm lights, grass, road, start stripe, walls and scenery. */
export function createScene(engine: Engine, track: Track): Scene {
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString(HORIZON + 'FF');
  scene.ambientColor = new Color3(0, 0, 0);
  scene.skipPointerMovePicking = true;
  scene.detachControl();
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = Color3.FromHexString(HORIZON);

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = HEMI_INTENSITY;
  hemi.diffuse = SKY_FILL;
  hemi.groundColor = GROUND_FILL;
  hemi.specular = Color3.Black();

  const sun = new DirectionalLight('sun', SUN_DIR.negate(), scene);
  sun.intensity = SUN_INTENSITY;
  sun.diffuse = SUN_COLOR;
  sun.specular = Color3.Black();

  // Shared shader clock and camera framing, and fog that scales with the zoom. No allocations.
  scene.onBeforeRenderObservable.add(() => {
    ENV.x += Math.min(0.1, engine.getDeltaTime() / 1000);
    const cam = scene.activeCamera as ArcRotateCamera | null;
    if (!cam || cam.radius === undefined) return;
    ENV.y = cam.target.x;
    ENV.z = cam.target.z;
    ENV.w = cam.radius;
    scene.fogStart = cam.radius * FOG_START;
    scene.fogEnd = cam.radius * FOG_END;
  });

  buildSky(scene);
  const noise = noiseTexture(scene);
  buildGround(scene, track, noise);
  buildRoad(scene, track, noise);
  buildBoostPads(scene, track);
  buildWalls(scene, track);
  buildScenery(scene, track);
  buildPond(scene);
  buildClouds(scene, track);

  return scene;
}
