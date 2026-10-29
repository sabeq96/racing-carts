import type { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import type { Kart } from '../kart/kart';
import { blobShadowMaterial, matte } from './scene';

/** Maximum body roll (radians) and how much sideways slip produces it. */
const MAX_LEAN = 0.16;
const LEAN_PER_SLIP = 0.05;
const LEAN_RATE = 10;
/** Karts are drawn a touch larger than their physics radius so they read from the couch. */
const VISUAL_SCALE = 1.15;
const WHEEL_X = 0.86, WHEEL_Z = 0.78, WHEEL_R = 0.34;

interface View {
  root: TransformNode;
  tilt: TransformNode;
  lean: number;
  /** Frame number of the last update that saw this kart. */
  seen: number;
}

/** Shared template meshes; each kart gets clones that reuse the same geometry. */
interface Template {
  body: Mesh;
  nose: Mesh;
  head: Mesh;
  wheel: Mesh;
  shadow: Mesh;
}

/** Chunky rounded karts, one cloned mesh group per kart, synced from the simulation each frame. */
export class KartViews {
  private views = new Map<number, View>();
  private template: Template;
  private bodyMats = new Map<string, StandardMaterial>();
  private frame = 0;
  private stale: number[] = [];

  constructor(private scene: Scene) {
    const body = CreateCapsule(
      'kartBody',
      { orientation: new Vector3(0, 0, 1), height: 2.5, radius: 0.66, tessellation: 10, subdivisions: 1, capSubdivisions: 3 },
      scene,
    );
    body.scaling.set(1.3, 0.85, 1);
    body.position.y = 0.66;

    const nose = CreateSphere('kartNose', { diameter: 0.5, segments: 4 }, scene);
    nose.position.set(0, 0.7, 1.2);

    const head = CreateSphere('kartHead', { diameter: 0.8, segments: 6 }, scene);
    head.position.set(0, 1.42, -0.42);

    const wheel = CreateCylinder('kartWheel', { height: 0.38, diameter: WHEEL_R * 2, tessellation: 10 }, scene);
    wheel.rotation.z = Math.PI / 2;

    const shadow = CreateDisc('kartShadow', { radius: 1.35, tessellation: 16 }, scene);
    shadow.rotation.x = Math.PI / 2;
    shadow.scaling.y = 1.3; // disc lies flat; local y becomes world z → longer than wide
    shadow.position.y = 0.05;

    const dark = matte('kartDark', '#5B4A44', scene);
    const cream = matte('kartCream', '#FFF3E0', scene);
    nose.material = dark;
    head.material = cream;
    wheel.material = dark;
    const shadowMat = blobShadowMaterial(scene);
    shadow.material = shadowMat;
    for (const m of [dark, cream, shadowMat]) m.freeze();

    this.template = { body, nose, head, wheel, shadow };
    for (const mesh of Object.values(this.template)) {
      mesh.isPickable = false;
      mesh.setEnabled(false);
    }
  }

  private bodyMaterial(color: string): StandardMaterial {
    let m = this.bodyMats.get(color);
    if (!m) {
      m = matte('kart' + color, color, this.scene);
      m.freeze();
      this.bodyMats.set(color, m);
    }
    return m;
  }

  private create(k: Kart): View {
    const t = this.template;
    const root = new TransformNode('kart' + k.id, this.scene);
    root.scaling.setAll(VISUAL_SCALE);
    const tilt = new TransformNode('kartTilt' + k.id, this.scene);
    tilt.parent = root;

    const part = (src: Mesh, parent: TransformNode): Mesh => {
      const m = src.clone(src.name + k.id, parent);
      m.setEnabled(true);
      m.isPickable = false;
      return m;
    };
    const body = part(t.body, tilt);
    body.material = this.bodyMaterial(k.color);
    part(t.nose, tilt);
    part(t.head, tilt);
    for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      part(t.wheel, root).position.set(x * WHEEL_X, WHEEL_R, z * WHEEL_Z);
    }
    part(t.shadow, root);
    return { root, tilt, lean: 0, seen: this.frame };
  }

  /** Syncs every kart's position, heading and lean; drops views of karts that no longer exist. */
  update(karts: Kart[]): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    const blend = 1 - Math.exp(-LEAN_RATE * dt);
    const frame = ++this.frame;
    for (const k of karts) {
      let v = this.views.get(k.id);
      if (!v) {
        v = this.create(k);
        this.views.set(k.id, v);
      }
      v.seen = frame;
      v.root.position.set(k.pos.x, 0, k.pos.z);
      v.root.rotation.y = k.heading;
      // While turning, velocity lags the nose; that sideways slip rolls the body outwards.
      const slip = k.vel.x * Math.cos(k.heading) - k.vel.z * Math.sin(k.heading);
      const want = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, -slip * LEAN_PER_SLIP));
      v.lean += (want - v.lean) * blend;
      v.tilt.rotation.z = v.lean;
    }
    // Only when some view has no kart any more (rare) do we walk the map; steady frames allocate nothing.
    if (this.views.size > karts.length) {
      const stale = this.stale;
      stale.length = 0;
      this.views.forEach((v, id) => {
        if (v.seen !== frame) stale.push(id);
      });
      for (const id of stale) {
        this.views.get(id)?.root.dispose();
        this.views.delete(id);
      }
    }
  }
}
