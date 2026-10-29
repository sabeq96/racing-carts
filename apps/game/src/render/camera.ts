import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Vec2 } from '../math/vec2';
import type { Track } from '../track/track';

/** Looking from the south (−z) towards +z, so world +x is screen right. */
export const CAMERA_ALPHA = -Math.PI / 2;
/** Angle from vertical: a friendly three-quarter view from above. */
export const CAMERA_BETA = 0.9;
export const MIN_RADIUS = 35;
/** Vertical field of view (radians). */
const FOV = 0.8;
/** Per-second rate of the exponential follow. */
const FOLLOW_RATE = 3;

const radiusFor = (spanX: number, spanZ: number, aspect: number): number =>
  Math.max(spanX / aspect, spanZ) * 1.2 + 25;

/** Target and arc radius that frame `points`, never closer than MIN_RADIUS nor wider than the whole track. */
export function fitCamera(points: Vec2[], aspect: number, bounds: Track['bounds']): { target: Vec2; radius: number } {
  const maxRadius = radiusFor(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, aspect);
  if (points.length === 0) {
    return {
      target: { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 },
      radius: Math.min(maxRadius, MIN_RADIUS),
    };
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const radius = Math.min(maxRadius, Math.max(MIN_RADIUS, radiusFor(maxX - minX, maxZ - minZ, aspect)));
  return { target: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }, radius };
}

/** One shared ArcRotateCamera with fixed angles that eases towards the framing of the given karts. */
export class CameraRig {
  readonly camera: ArcRotateCamera;
  private snapped = false;

  constructor(scene: Scene, private bounds: Track['bounds']) {
    const c = (this.bounds.minX + this.bounds.maxX) / 2, z = (this.bounds.minZ + this.bounds.maxZ) / 2;
    this.camera = new ArcRotateCamera('cam', CAMERA_ALPHA, CAMERA_BETA, MIN_RADIUS, new Vector3(c, 0, z), scene);
    this.camera.fov = FOV;
    this.camera.minZ = 5; // nothing is ever this close; a far near plane keeps depth precise
    this.camera.maxZ = 2000;
    // No user control: the rig owns the camera.
    this.camera.inputs.clear();
  }

  /** Moves towards the framing of `points` (snaps on the first call). */
  update(points: Vec2[], aspect: number, dt: number): void {
    const want = fitCamera(points, aspect, this.bounds);
    const t = this.snapped ? 1 - Math.exp(-FOLLOW_RATE * dt) : 1;
    this.snapped = true;
    const cam = this.camera;
    const target = cam.target; // the camera reads this vector every frame
    target.copyFromFloats(target.x + (want.target.x - target.x) * t, 0, target.z + (want.target.z - target.z) * t);
    cam.radius += (want.radius - cam.radius) * t;
    cam.alpha = CAMERA_ALPHA;
    cam.beta = CAMERA_BETA;
  }
}
