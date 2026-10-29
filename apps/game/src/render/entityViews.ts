import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
// Side effect: registers `Mesh.createInstance` (a type-only import would be erased).
import '@babylonjs/core/Meshes/instancedMesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { ItemBoxes } from '../powerups/itemBoxes';
import type { EntityLook, PowerupEntity } from '../powerups/types';
import { blobShadowMaterial, matte } from './scene';
import { toonMaterial } from './shaders';

/** Item boxes: edge length (m), float height of the centre, corner rounding. */
const BOX_SIZE = 1.4;
const BOX_Y = 1;
const BOX_ROUND = 0.28;
const BOX_SPIN = 1.6;
const BOX_BOB = 0.12;
/** Fixed tilt so three faces (three colours) show at once while it spins. */
const BOX_TILT = 0.55;
/** How fast a respawned box grows back in (per second, exponential). */
const POP_RATE = 9;
/** Pastel rainbow, one colour per face: +x, −x, +y, −y, +z, −z. */
const FACE_COLORS = ['#FF8A80', '#82B1FF', '#FFE38A', '#C9B6F2', '#9BE7C4', '#FFC09F'];
/** Radius of the shared blob-shadow disc that every shadow instance scales from. */
const SHADOW_RADIUS = 0.75;
/** Entities with `look.spin` turn this fast (rad/s). */
const ENTITY_SPIN = 1.5;
/** A disc's thickness when its look gives no `height`. */
const DISC_HEIGHT = 0.1;

/**
 * A rounded cube: a sphere's vertices pushed out to the corners of a smaller cube (the Minkowski sum of
 * a cube and a sphere). Triangles that straddle a face stretch flat across it; the sphere normals give
 * the faces a soft pillowy shading. Each vertex takes the colour of the face its normal points at most.
 */
function roundedCube(size: number, round: number): VertexData {
  const sphere = VertexData.CreateSphere({ segments: 10, diameter: 2 });
  const pos = sphere.positions as number[];
  const normals = sphere.normals as number[];
  const core = size / 2 - round;
  const colors: number[] = [];
  const faces = FACE_COLORS.map((h) => Color3.FromHexString(h));
  for (let i = 0; i < pos.length; i += 3) {
    const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
    pos[i] = (nx >= 0 ? core : -core) + nx * round;
    pos[i + 1] = (ny >= 0 ? core : -core) + ny * round;
    pos[i + 2] = (nz >= 0 ? core : -core) + nz * round;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const face = ax >= ay && ax >= az ? (nx >= 0 ? 0 : 1) : ay >= az ? (ny >= 0 ? 2 : 3) : nz >= 0 ? 4 : 5;
    const c = faces[face];
    colors.push(c.r, c.g, c.b, 1);
  }
  const data = new VertexData();
  data.positions = pos;
  data.indices = sphere.indices;
  data.normals = normals;
  data.colors = colors;
  return data;
}

interface BoxView {
  box: InstancedMesh;
  shadow: InstancedMesh;
  /** 0 = hidden, grows to 1 when the box is back. */
  scale: number;
}

interface PieceView {
  mesh: Mesh;
  shadow: InstancedMesh;
  /** Height of the mesh centre. */
  y: number;
  spin: boolean;
  /** Spin offset, so spinning entities do not turn in lockstep. */
  phase: number;
  /** The `frame` that last saw its entity; older views are disposed. */
  seen: number;
}

/** Vertical extent of a look's shape (m). */
function lookHeight(look: EntityLook): number {
  if (look.shape === 'disc') return look.height ?? DISC_HEIGHT;
  if (look.shape === 'cone') return look.size;
  return look.height ?? look.size;
}

/**
 * Things on the track besides karts: spinning item boxes, and every powerup entity (`world.entities`),
 * drawn generically from its `EntityLook` so a new item needs no render code.
 */
export class EntityViews {
  private boxSource: Mesh;
  private shadowSource: Mesh;
  private boxes: BoxView[] = [];
  private time = 0;
  /** One view per live entity, keyed by the entity object itself. */
  private pieces = new Map<PowerupEntity, PieceView>();
  private frame = 0;
  /** Matte pastel materials, one per colour. */
  private mats = new Map<string, StandardMaterial>();
  /** Unlit glowing materials (trails), one per colour. */
  private glows = new Map<string, StandardMaterial>();
  private serial = 0;
  /** Bound once, so the per-frame sweep allocates nothing. */
  private readonly sweep = (v: PieceView, e: PowerupEntity): void => {
    if (v.seen === this.frame) return;
    v.mesh.dispose(); // children (accent, trail) go with it; shared materials stay
    v.shadow.dispose();
    this.pieces.delete(e);
  };

  constructor(private scene: Scene) {
    const box = new Mesh('itemBox', scene);
    roundedCube(BOX_SIZE, BOX_ROUND).applyToMesh(box);
    // White toon: the vertex colours carry the rainbow, which slowly drifts round the hue wheel.
    box.material = toonMaterial('itemBox', '#FFFFFF', scene, 0.2, 'shimmer');
    // Sources stay enabled but invisible: only their instances are drawn.
    box.isPickable = false;
    box.isVisible = false;
    this.boxSource = box;

    const shadow = CreateDisc('blobShadow', { radius: SHADOW_RADIUS, tessellation: 14 }, scene);
    shadow.rotation.x = Math.PI / 2;
    shadow.material = blobShadowMaterial(scene);
    shadow.isPickable = false;
    shadow.isVisible = false;
    this.shadowSource = shadow;
  }

  private ensureBoxes(count: number): void {
    while (this.boxes.length < count) {
      const i = this.boxes.length;
      const box = this.boxSource.createInstance('itemBox' + i);
      const shadow = this.shadowSource.createInstance('itemBoxShadow' + i);
      box.isPickable = false;
      shadow.isPickable = false;
      shadow.rotation.x = Math.PI / 2;
      this.boxes.push({ box, shadow, scale: 1 });
    }
    while (this.boxes.length > count) {
      const v = this.boxes.pop() as BoxView;
      v.box.dispose();
      v.shadow.dispose();
    }
  }

  /** Matte pastel material for `hex`, made once per colour. */
  private matteFor(hex: string): StandardMaterial {
    let m = this.mats.get(hex);
    if (!m) {
      m = matte('entity' + hex, hex, this.scene);
      m.freeze();
      this.mats.set(hex, m);
    }
    return m;
  }

  /** Unlit, slightly see-through glow for `hex` (a rocket's exhaust puff). */
  private glowFor(hex: string): StandardMaterial {
    let m = this.glows.get(hex);
    if (!m) {
      m = new StandardMaterial('glow' + hex, this.scene);
      m.disableLighting = true;
      m.emissiveColor = Color3.FromHexString(hex);
      m.alpha = 0.8;
      m.freeze();
      this.glows.set(hex, m);
    }
    return m;
  }

  /** Builds the mesh for a look: the shape, plus an optional accent dot on top and a trail behind. */
  private build(look: EntityLook): PieceView {
    const scene = this.scene;
    const name = 'entity' + this.serial++;
    const s = look.size;
    const h = lookHeight(look);
    let mesh: Mesh;
    if (look.shape === 'sphere') {
      mesh = CreateSphere(name, { diameterX: s, diameterY: h, diameterZ: s, segments: 6 }, scene);
    } else if (look.shape === 'box') {
      mesh = CreateBox(name, { width: s, height: h, depth: s }, scene);
    } else if (look.shape === 'disc') {
      mesh = CreateCylinder(name, { diameter: s, height: h, tessellation: 18 }, scene);
    } else {
      // Lying down, 2 × size long: the tip (+y) turned to +z, which `rotation.y = heading` points forward.
      mesh = CreateCylinder(name, { diameterTop: 0, diameterBottom: s, height: 2 * s, tessellation: 10 }, scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices();
    }
    mesh.material = this.matteFor(look.color);
    mesh.isPickable = false;

    if (look.accent) {
      const d = Math.max(0.15, s * 0.3);
      const dot = CreateSphere(name + 'accent', { diameter: d, segments: 4 }, scene);
      dot.material = this.matteFor(look.accent);
      dot.isPickable = false;
      dot.parent = mesh;
      dot.position.y = h / 2 + d * 0.2;
    }
    if (look.trail) {
      const back = look.shape === 'cone' ? s : s / 2;
      const len = s * 1.2;
      // A short puff tapering away behind the shape, narrower than it so the shape still shows from behind.
      const puff = CreateCylinder(name + 'trail', { diameterTop: s * 0.42, diameterBottom: 0, height: len, tessellation: 8 }, scene);
      puff.rotation.x = Math.PI / 2;
      puff.bakeCurrentTransformIntoVertices();
      puff.material = this.glowFor(look.trail);
      puff.isPickable = false;
      puff.parent = mesh;
      puff.position.z = -back - len / 2;
    }

    const shadow = this.shadowSource.createInstance(name + 'shadow');
    shadow.isPickable = false;
    shadow.rotation.x = Math.PI / 2;
    shadow.scaling.setAll(((look.shape === 'cone' ? 0.8 : 0.55) * s) / SHADOW_RADIUS);
    return { mesh, shadow, y: look.y ?? h / 2, spin: look.spin === true, phase: this.serial * 1.7, seen: 0 };
  }

  /** The mesh drawing `e`, if it has one (for tests). */
  meshOf(e: PowerupEntity): Mesh | undefined {
    return this.pieces.get(e)?.mesh;
  }

  /** How many entity views exist. */
  count(): number {
    return this.pieces.size;
  }

  /**
   * Syncs item boxes (hidden while respawning, then popping back in, spinning and bobbing) and powerup
   * entities (a mesh per entity, made when it appears and disposed when it is gone).
   */
  update(itemBoxes: ItemBoxes, entities: readonly PowerupEntity[], dt: number): void {
    this.time += dt;
    this.updateBoxes(itemBoxes, dt);

    this.frame++;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.dead) continue;
      let v = this.pieces.get(e);
      if (!v) {
        v = this.build(e.look);
        this.pieces.set(e, v);
      }
      v.seen = this.frame;
      v.mesh.position.set(e.pos.x, v.y, e.pos.z);
      v.mesh.rotation.y = v.spin ? this.time * ENTITY_SPIN + v.phase : e.heading;
      v.shadow.position.set(e.pos.x, 0.04, e.pos.z);
    }
    this.pieces.forEach(this.sweep);
  }

  private updateBoxes(itemBoxes: ItemBoxes, dt: number): void {
    const list = itemBoxes.boxes;
    this.ensureBoxes(list.length);
    const grow = 1 - Math.exp(-POP_RATE * dt);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const v = this.boxes[i];
      const visible = b.respawn <= 0;
      v.scale = visible ? v.scale + (1 - v.scale) * grow : 0;
      const on = v.scale > 0.01;
      if (v.box.isEnabled() !== on) {
        v.box.setEnabled(on);
        v.shadow.setEnabled(on);
      }
      if (!on) continue;
      const phase = i * 1.7;
      v.box.position.set(b.pos.x, BOX_Y + Math.sin(this.time * 2.2 + phase) * BOX_BOB, b.pos.z);
      v.box.rotation.set(BOX_TILT, this.time * BOX_SPIN + phase, BOX_TILT);
      v.box.scaling.setAll(v.scale);
      v.shadow.position.set(b.pos.x, 0.05, b.pos.z);
      v.shadow.scaling.setAll(v.scale);
    }
  }
}
