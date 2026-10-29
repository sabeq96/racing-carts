import { afterAll, describe, expect, test } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { ItemBoxes } from '../powerups/itemBoxes';
import type { EntityLook, PowerupEntity } from '../powerups/types';
import { EntityViews } from './entityViews';

const engine = new NullEngine({ renderWidth: 640, renderHeight: 360, textureSize: 256, deterministicLockstep: false, lockstepMaxSteps: 1 });
afterAll(() => engine.dispose());
const track = buildTrack(TRACK_V1);

const ent = (look: EntityLook, x = 0, z = 0, heading = 0): PowerupEntity => ({
  pos: { x, z },
  heading,
  look,
  hitRadius: 1,
  dead: false,
  update() {},
});

function setup(): { scene: Scene; views: EntityViews; boxes: ItemBoxes } {
  const scene = new Scene(engine);
  return { scene, views: new EntityViews(scene), boxes: new ItemBoxes(track) };
}

/** World-space vertex positions of a mesh. */
function worldVerts(m: AbstractMesh): Vector3[] {
  m.computeWorldMatrix(true);
  const data = m.getVerticesData(VertexBuffer.PositionKind) as number[];
  const out: Vector3[] = [];
  const w = m.getWorldMatrix();
  for (let i = 0; i < data.length; i += 3) out.push(Vector3.TransformCoordinates(new Vector3(data[i], data[i + 1], data[i + 2]), w));
  return out;
}

describe('entity views', () => {
  test('one mesh per entity, kept across frames, disposed when the entity is gone', () => {
    const { scene, views, boxes } = setup();
    const a = ent({ shape: 'sphere', color: '#FF8A80', size: 0.9, y: 0.45 }, 5, 6);
    const b = ent({ shape: 'box', color: '#9BE7C4', size: 1 }, -3, 2);
    const list = [a, b];
    views.update(boxes, list, 1 / 60);
    const ma = views.meshOf(a) as AbstractMesh;
    const mb = views.meshOf(b) as AbstractMesh;
    expect(ma).toBeTruthy();
    expect(mb).toBeTruthy();
    expect(ma).not.toBe(mb);
    expect(ma.position.x).toBeCloseTo(5);
    expect(ma.position.y).toBeCloseTo(0.45);
    expect(ma.position.z).toBeCloseTo(6);
    // Default height: resting on the ground.
    expect(mb.position.y).toBeCloseTo(0.5);
    const meshCount = scene.meshes.length;

    a.pos.x = 7;
    views.update(boxes, list, 1 / 60);
    expect(views.meshOf(a)).toBe(ma);
    expect(ma.position.x).toBeCloseTo(7);
    expect(scene.meshes.length).toBe(meshCount);

    list.splice(0, 1);
    views.update(boxes, list, 1 / 60);
    expect(views.meshOf(a)).toBeUndefined();
    expect(ma.isDisposed()).toBe(true);
    expect(mb.isDisposed()).toBe(false);
    // Its mesh, any child and its blob shadow are all gone.
    expect(scene.meshes.length).toBeLessThan(meshCount);

    views.update(boxes, [], 1 / 60);
    expect(mb.isDisposed()).toBe(true);
    expect(views.count()).toBe(0);
  });

  test('materials are shared per colour', () => {
    const { scene, views, boxes } = setup();
    const a = ent({ shape: 'sphere', color: '#FF8A80', size: 1 });
    const b = ent({ shape: 'disc', color: '#FF8A80', size: 2, height: 0.05 });
    const c = ent({ shape: 'sphere', color: '#82B1FF', size: 1 });
    views.update(boxes, [a, b, c], 1 / 60);
    expect(views.meshOf(a)?.material).toBe(views.meshOf(b)?.material);
    expect(views.meshOf(a)?.material).not.toBe(views.meshOf(c)?.material);
    const mats = scene.materials.length;
    views.update(boxes, [ent({ shape: 'cone', color: '#FF8A80', size: 1 })], 1 / 60);
    expect(scene.materials.length).toBe(mats);
  });

  test('a disc is size across and height thick', () => {
    const { views, boxes } = setup();
    const d = ent({ shape: 'disc', color: '#5B4A44', size: 2.4, height: 0.05, y: 0.03 });
    views.update(boxes, [d], 1 / 60);
    const m = views.meshOf(d) as AbstractMesh;
    const v = worldVerts(m);
    const ys = v.map((p) => p.y), xs = v.map((p) => p.x);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.05, 3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2.4, 1);
  });

  test('a cone lies along the heading, nose forward', () => {
    const { views, boxes } = setup();
    for (const heading of [0, 1, -2.2]) {
      const r = ent({ shape: 'cone', color: '#82B1FF', size: 1, y: 0.8 }, 10, 20, heading);
      views.update(boxes, [r], 1 / 60);
      const m = views.meshOf(r) as AbstractMesh;
      const fx = Math.sin(heading), fz = Math.cos(heading);
      const verts = worldVerts(m).map((p) => {
        const dx = p.x - 10, dz = p.z - 20;
        return { fwd: dx * fx + dz * fz, side: Math.abs(dx * fz - dz * fx), up: Math.abs(p.y - 0.8) };
      });
      const maxF = Math.max(...verts.map((v) => v.fwd));
      const minF = Math.min(...verts.map((v) => v.fwd));
      // Longer than it is wide, lying flat.
      expect(maxF - minF).toBeGreaterThan(1.2);
      // The nose (front-most vertices) is a point; the wide base is at the back.
      const nose = verts.filter((v) => v.fwd > maxF - 0.05);
      const tail = verts.filter((v) => v.fwd < minF + 0.05);
      expect(Math.max(...nose.map((v) => Math.max(v.side, v.up)))).toBeLessThan(0.05);
      expect(Math.max(...tail.map((v) => v.side))).toBeGreaterThan(0.4);
    }
  });

  test('an accent adds a small dark dot on top; spinning shapes turn', () => {
    const { views, boxes } = setup();
    const m = ent({ shape: 'sphere', color: '#FF8A80', size: 0.9, y: 0.45, accent: '#4A3A30', spin: true });
    views.update(boxes, [m], 1 / 60);
    const mesh = views.meshOf(m) as AbstractMesh;
    const kids = mesh.getChildMeshes();
    expect(kids.length).toBe(1);
    const top = worldVerts(kids[0]);
    expect(Math.max(...top.map((p) => p.y))).toBeGreaterThan(0.9);
    const r0 = mesh.rotation.y;
    views.update(boxes, [m], 0.1);
    expect(mesh.rotation.y).not.toBeCloseTo(r0, 3);
  });
});
