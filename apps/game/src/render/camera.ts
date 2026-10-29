import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Vec2 } from '../math/vec2';
import type { Track } from '../track/track';

/** Looking from the south (−z) towards +z, so world +x is screen right. */
export const CAMERA_ALPHA = -Math.PI / 2;
/** Angle from vertical: a friendly three-quarter view from above. */
export const CAMERA_BETA = 0.9;
/** Vertical field of view (radians). */
export const CAMERA_FOV = 0.8;
export const MIN_RADIUS = 35;
/** Share of the screen (in NDC half-extent) that the padded box around the framed karts fills. */
const KART_FILL = 0.65;
/** Share of the screen the whole track fills at the widest zoom. */
const TRACK_FILL = 0.86;
/** Metres of padding around kart centres, so the karts themselves stay well inside the frame. */
const KART_PAD = 3;
/** From this fraction of the whole-track radius upwards, the framed box eases out to the track bounds. */
const BLEND_FROM = 0.7;
/** Per-second rate of the exponential follow. */
const FOLLOW_RATE = 3;

/** Camera shake: trauma a hit on a human kart adds, capped at MAX_TRAUMA, fading out at HIT_TRAUMA per SHAKE_FADE s. */
export const HIT_TRAUMA = 0.5;
export const MAX_TRAUMA = 0.75;
const SHAKE_FADE = 0.4;
/**
 * The target moves by trauma² × SHAKE_PER_RADIUS × camera radius metres of quick smooth noise: the same
 * share of the screen at every zoom (one hit ≈ 1.25 % of the radius, a few percent of the screen height).
 */
export const SHAKE_PER_RADIUS = 0.05;

const SIN_B = Math.sin(CAMERA_BETA);
const COS_B = Math.cos(CAMERA_BETA);
const TAN_HALF_FOV = Math.tan(CAMERA_FOV / 2);

/*
 * Camera geometry. With alpha = −π/2 the camera sits at target + (0, R·cosβ, −R·sinβ). A ground point
 * that is dz metres beyond the target (along +z) and dx to the side lands at
 *   depth = R + dz·sinβ,   ndcY = dz·cosβ / (depth·tan(fov/2)),   ndcX = dx / (depth·tan(fov/2)·aspect).
 * Far ground is squeezed and near ground stretched, so a box centred on the target looks bottom-heavy.
 */

/**
 * How far to move the target along z (negative: toward the camera) so that the near and far edges of
 * a box of half-depth `hz` sit symmetrically on screen at radius `r`.
 * Solves a·(R − b·s) = b·(R + a·s) with a = hz − δ (far), b = hz + δ (near): s·δ² − R·δ − s·hz² = 0.
 */
export function perspectiveOffset(r: number, hz: number): number {
  return (r - Math.sqrt(r * r + 4 * SIN_B * SIN_B * hz * hz)) / (2 * SIN_B);
}

/** Largest |NDC| reached by a box of half-extents (hx, hz), framed at radius r with the offset target. */
function boxExtent(r: number, hx: number, hz: number, aspect: number): number {
  const d = perspectiveOffset(r, hz);
  const far = hz - d, near = hz + d;
  const nearDepth = r - near * SIN_B;
  if (nearDepth <= 0) return Infinity;
  const y = (far * COS_B) / ((r + far * SIN_B) * TAN_HALF_FOV);
  // The widest point of the box on screen is its near edge.
  const x = hx / (nearDepth * TAN_HALF_FOV * aspect);
  return Math.max(x, y);
}

/** Smallest radius at which the box's largest |NDC| is at most `fill` (extent shrinks as r grows). */
function radiusToFit(hx: number, hz: number, aspect: number, fill: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40 && boxExtent(hi, hx, hz, aspect) > fill; i++) {
    lo = hi;
    hi *= 2;
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (boxExtent(mid, hx, hz, aspect) > fill) lo = mid;
    else hi = mid;
  }
  return hi;
}

const smoothstep = (t: number): number => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};

/** Radius at which the whole track (its bounds) fills the screen. */
export function wholeTrackRadius(aspect: number, bounds: Track['bounds']): number {
  const hx = (bounds.maxX - bounds.minX) / 2, hz = (bounds.maxZ - bounds.minZ) / 2;
  return Math.max(MIN_RADIUS, radiusToFit(hx, hz, aspect, TRACK_FILL));
}

/**
 * Target and arc radius that frame `points` (kart centres) on screen with even top/bottom margins.
 * - The padded box around the points fills about KART_FILL of the screen; radius is clamped to
 *   [MIN_RADIUS, whole-track radius], so the camera never zooms out past the whole track.
 * - The target is the box centre moved toward the camera to undo the perspective squeeze, so the
 *   box's near and far edges sit symmetrically on screen.
 * - As the needed radius nears the whole-track radius, the box eases out to the track bounds (and the
 *   fill to TRACK_FILL); whenever the radius would reach the whole-track radius the result is exactly
 *   the whole-track framing (track centre plus the same perspective offset).
 * - No points: the whole-track view.
 * The box always contains the points and stays inside `bounds`, so every point inside `bounds` stays
 * within ±max(KART_FILL, TRACK_FILL) NDC (tested against ±0.9).
 */
export function fitCamera(points: Vec2[], aspect: number, bounds: Track['bounds']): { target: Vec2; radius: number } {
  const maxRadius = wholeTrackRadius(aspect, bounds);
  const wholeTrack = () => ({
    target: {
      x: (bounds.minX + bounds.maxX) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2 + perspectiveOffset(maxRadius, (bounds.maxZ - bounds.minZ) / 2),
    },
    radius: maxRadius,
  });
  if (points.length === 0) return wholeTrack();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z;
    if (p.z > z1) z1 = p.z;
  }
  // Pad, but never past the track bounds: inside them the whole-track radius always fits the box.
  x0 = Math.max(bounds.minX, x0 - KART_PAD); x1 = Math.min(bounds.maxX, x1 + KART_PAD);
  z0 = Math.max(bounds.minZ, z0 - KART_PAD); z1 = Math.min(bounds.maxZ, z1 + KART_PAD);
  if (x0 > x1) x0 = x1 = Math.max(bounds.minX, Math.min(bounds.maxX, x0));
  if (z0 > z1) z0 = z1 = Math.max(bounds.minZ, Math.min(bounds.maxZ, z0));
  // How zoomed out the karts alone would need; near the whole-track radius the framed box grows
  // toward the track bounds, so the view eases into exactly the whole-track framing.
  const r0 = radiusToFit((x1 - x0) / 2, (z1 - z0) / 2, aspect, KART_FILL);
  const t = smoothstep((r0 - BLEND_FROM * maxRadius) / ((1 - BLEND_FROM) * maxRadius));
  // Lerping toward the enclosing bounds only ever grows the box, so it still holds every kart.
  x0 += (bounds.minX - x0) * t; x1 += (bounds.maxX - x1) * t;
  z0 += (bounds.minZ - z0) * t; z1 += (bounds.maxZ - z1) * t;

  const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // The fill eases the same way, so t = 1 is exactly the whole-track framing (bounds at TRACK_FILL)
  // and the radius only reaches the whole-track radius there, with the target on the track centre.
  const fill = KART_FILL + (TRACK_FILL - KART_FILL) * t;
  const radius = Math.max(MIN_RADIUS, radiusToFit(hx, hz, aspect, fill));
  // Never wider than the whole track, and never a shifted view at that zoom.
  if (radius >= maxRadius) return wholeTrack();
  return { target: { x: cx, z: cz + perspectiveOffset(radius, hz) }, radius };
}

/** Trauma after `dt` seconds: a hit's HIT_TRAUMA fades linearly to 0 in SHAKE_FADE seconds. */
export function decayTrauma(trauma: number, dt: number): number {
  return Math.max(0, trauma - (HIT_TRAUMA / SHAKE_FADE) * dt);
}

/**
 * Writes the shake offset (m) for `trauma` at `time` into `out`, for a camera at `radius`: trauma² ×
 * SHAKE_PER_RADIUS × radius times two sums of sines in [−1, 1] at 30-40 rad/s (a quick wobble, smooth
 * frame to frame). Allocation-free.
 */
export function shakeOffset(trauma: number, time: number, radius: number, out: Vec2): void {
  const a = trauma * trauma * SHAKE_PER_RADIUS * radius;
  if (a === 0) {
    out.x = 0;
    out.z = 0;
    return;
  }
  out.x = a * (0.6 * Math.sin(time * 33) + 0.4 * Math.sin(time * 39.7 + 1.7));
  out.z = a * (0.6 * Math.sin(time * 30.1 + 0.4) + 0.4 * Math.sin(time * 37.3 + 2.9));
}

/** One shared ArcRotateCamera with fixed angles that eases towards the framing of the given karts. */
export class CameraRig {
  readonly camera: ArcRotateCamera;
  private snapped = false;
  /** Where the camera looks without shake (the eased framing); the shake is added on top. */
  private baseX = 0;
  private baseZ = 0;
  private traumaLeft = 0;
  private time = 0;
  private readonly shake: Vec2 = { x: 0, z: 0 };

  constructor(scene: Scene, private bounds: Track['bounds']) {
    const c = (this.bounds.minX + this.bounds.maxX) / 2, z = (this.bounds.minZ + this.bounds.maxZ) / 2;
    this.camera = new ArcRotateCamera('cam', CAMERA_ALPHA, CAMERA_BETA, MIN_RADIUS, new Vector3(c, 0, z), scene);
    this.camera.fov = CAMERA_FOV;
    this.camera.minZ = 5; // nothing is ever this close; a far near plane keeps depth precise
    this.camera.maxZ = 2000;
    // No user control: the rig owns the camera.
    this.camera.inputs.clear();
    this.baseX = c;
    this.baseZ = z;
  }

  /** A human kart was hit: shake the view a little (HIT_TRAUMA per hit, capped at MAX_TRAUMA). */
  addTrauma(amount: number): void {
    this.traumaLeft = Math.min(MAX_TRAUMA, this.traumaLeft + amount);
  }

  /** Current shake trauma (0 = calm). */
  get trauma(): number {
    return this.traumaLeft;
  }

  /** Moves towards the framing of `points` (snaps on the first call), plus any shake. */
  update(points: Vec2[], aspect: number, dt: number): void {
    const want = fitCamera(points, aspect, this.bounds);
    const t = this.snapped ? 1 - Math.exp(-FOLLOW_RATE * dt) : 1;
    this.snapped = true;
    const cam = this.camera;
    this.baseX += (want.target.x - this.baseX) * t;
    this.baseZ += (want.target.z - this.baseZ) * t;
    this.time += dt;
    cam.radius += (want.radius - cam.radius) * t;
    this.traumaLeft = decayTrauma(this.traumaLeft, dt);
    shakeOffset(this.traumaLeft, this.time, cam.radius, this.shake);
    // The camera reads this vector every frame.
    cam.target.copyFromFloats(this.baseX + this.shake.x, 0, this.baseZ + this.shake.z);
    cam.alpha = CAMERA_ALPHA;
    cam.beta = CAMERA_BETA;
  }
}
