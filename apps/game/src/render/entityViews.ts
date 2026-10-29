import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
// Side effect: registers `Mesh.createInstance` (a type-only import would be erased).
import '@babylonjs/core/Meshes/instancedMesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { ItemBoxes } from '../powerups/itemBoxes';
import { blobShadowMaterial, matte } from './scene';

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

/** Things on the track besides karts: spinning item boxes (and, from Task 12, item entities). */
export class EntityViews {
  private boxSource: Mesh;
  private shadowSource: Mesh;
  private boxes: BoxView[] = [];
  private time = 0;

  constructor(private scene: Scene) {
    const box = new Mesh('itemBox', scene);
    roundedCube(BOX_SIZE, BOX_ROUND).applyToMesh(box);
    // White matte: the vertex colours carry the rainbow, so faces read as the palette colours.
    const mat = matte('itemBox', '#FFFFFF', scene);
    mat.freeze();
    box.material = mat;
    // Sources stay enabled but invisible: only their instances are drawn.
    box.isPickable = false;
    box.isVisible = false;
    this.boxSource = box;

    const shadow = CreateDisc('itemBoxShadow', { radius: 0.75, tessellation: 14 }, scene);
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

  /** Syncs item boxes: hidden while respawning, then popping back in, spinning and bobbing. */
  update(itemBoxes: ItemBoxes, dt: number): void {
    this.time += dt;
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
