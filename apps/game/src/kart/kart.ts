import type { InputSnapshot } from '@rc/shared';
import { Vec2, dist, dot } from '../math/vec2';
import type { Track } from '../track/track';
import {
  ACCEL,
  BOOST_FACTOR,
  BRAKE_DECEL,
  CATCHUP_WALL_PAUSE,
  COAST_DECEL,
  DRIFT_DRAG,
  DRIFT_END_SPEED,
  DRIFT_END_STEER,
  DRIFT_GRIP,
  DRIFT_START_SPEED,
  DRIFT_START_STEER,
  DRIFT_TURN_MAX,
  DRIFT_TURN_MIN,
  GRIP,
  KART_RADIUS,
  MAX_SPEED,
  MT1,
  MT1_BOOST,
  MT2,
  MT2_BOOST,
  REVERSE_MAX,
  STEER_RATE,
  WALL_RESTITUTION,
  WALL_SCRAPE,
  WALL_SPEED_KEEP,
} from './tuning';

export interface Effect {
  kind: string;
  remaining: number;
}

export interface Kart {
  id: number;
  color: string;
  pos: Vec2;
  vel: Vec2;
  heading: number;
  /** Signed forward speed. */
  speed: number;
  /** Seconds of spin-out left. */
  spin: number;
  effects: Effect[];
  item: string | null;
  rolling: { left: number; item: string } | null;
  itemPressed: boolean;
  distance: number;
  trackIndex: number;
  /** Signed offset from the centre line (m, right positive) as of the latest physics step. */
  lateral: number;
  finishedAt: number | null;
  /** Power slide: BRAKE + steer at speed. `charge` is seconds drifted (pays a mini-turbo on release). */
  drift: { active: boolean; charge: number };
  /** BRAKE was still held when a drift ended: it is ignored until let go (no hard stop after a slide). */
  brakeLatched: boolean;
  /** Seconds since the kart last touched a wall (catch-up waits CATCHUP_WALL_PAUSE after a touch). */
  sinceWall: number;
  /** Seconds spent in another kart's slipstream (see `stepSlipstream`); render shows streaks above 0.2. */
  draft: number;
}

export function createKart(id: number, color: string, slot: Track['grid'][number], track: Track): Kart {
  const pr = track.project(slot.pos);
  return {
    id,
    color,
    pos: { x: slot.pos.x, z: slot.pos.z },
    vel: { x: 0, z: 0 },
    heading: slot.heading,
    speed: 0,
    spin: 0,
    effects: [],
    item: null,
    rolling: null,
    itemPressed: false,
    distance: slot.s,
    trackIndex: pr.index,
    lateral: pr.lateral,
    finishedAt: null,
    drift: { active: false, charge: 0 },
    brakeLatched: false,
    sinceWall: CATCHUP_WALL_PAUSE,
    draft: 0,
  };
}

/** Seconds left on the kart's `kind` effect (0 when it has none). Allocation-free, for per-frame reads. */
export function effectLeft(k: Kart, kind: string): number {
  for (const e of k.effects) if (e.kind === kind) return e.remaining;
  return 0;
}

/**
 * Starts the kart's `kind` effect, or restarts it without stacking: the timer becomes `seconds`, unless
 * more is left already (a pad never cuts an item boost short). Shared by the powerup world and the karts.
 */
export function refreshEffect(k: Kart, kind: string, seconds: number): void {
  for (const e of k.effects) {
    if (e.kind === kind) {
      e.remaining = Math.max(e.remaining, seconds);
      return;
    }
  }
  k.effects.push({ kind, remaining: seconds });
}

/** How charged the kart's drift is, for the sparks and the phone: 0 (or not drifting), 1 from MT1, 2 from MT2. */
export function driftLevel(k: Kart): 0 | 1 | 2 {
  if (!k.drift.active) return 0;
  return k.drift.charge >= MT2 ? 2 : k.drift.charge >= MT1 ? 1 : 0;
}

/**
 * Turn rate while drifting, in units of STEER_RATE: DRIFT_TURN_MIN up to |steer| = DRIFT_START_STEER, then
 * rising linearly to DRIFT_TURN_MAX at full lock, with the sign of `steer`.
 */
export function driftTurn(steer: number): number {
  const t = Math.max(0, Math.min(1, (Math.abs(steer) - DRIFT_START_STEER) / (1 - DRIFT_START_STEER)));
  return Math.sign(steer) * (DRIFT_TURN_MIN + (DRIFT_TURN_MAX - DRIFT_TURN_MIN) * t);
}

/** Ends a drift: a charged one pays its mini-turbo as a boost (unless `cancel`), and the charge is gone. */
function endDrift(k: Kart, cancel: boolean): void {
  const d = k.drift;
  if (!cancel) {
    const level = driftLevel(k);
    if (level > 0) refreshEffect(k, 'boost', level === 2 ? MT2_BOOST : MT1_BOOST);
  }
  d.active = false;
  d.charge = 0;
  k.brakeLatched = true; // cleared on the first step BRAKE is up
}

/** Move `v` toward `target` by at most `step` (never overshooting). */
function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/**
 * One physics step. `topSpeedScale` multiplies the top speed (catch-up for karts behind; 1 = plain), except
 * while the kart touches a wall and CATCHUP_WALL_PAUSE seconds after; a boost multiplies on top of it.
 */
export function stepKart(
  k: Kart,
  input: InputSnapshot,
  track: Track,
  dt: number,
  topSpeedScale = 1,
): { hitWall: boolean } {
  const drift = k.drift;
  if (!input.brake) k.brakeLatched = false;
  const brake = input.brake && !k.brakeLatched;
  if (k.spin > 0) {
    if (drift.active) endDrift(k, true); // a spin-out loses the drift and its charge
    k.spin = Math.max(0, k.spin - dt);
    k.speed *= Math.exp(-3 * dt);
    k.heading += 10 * dt;
  } else {
    const steer = Math.max(-1, Math.min(1, input.steer));
    const turn = Math.abs(steer);
    if (drift.active) {
      if (!brake || turn <= DRIFT_END_STEER || k.speed < DRIFT_END_SPEED) endDrift(k, false);
    } else if (brake && turn > DRIFT_START_STEER && k.speed > DRIFT_START_SPEED) {
      drift.active = true;
      drift.charge = 0;
    }
    const boost = effectLeft(k, 'boost') > 0;
    const scale = k.sinceWall >= CATCHUP_WALL_PAUSE ? topSpeedScale : 1;
    const max = MAX_SPEED * scale * (boost ? BOOST_FACTOR : 1);
    if (drift.active) {
      // A drift holds its speed: brake only means "slide", with a mild drag (or the usual ease-off above max).
      k.speed = k.speed > max ? Math.max(max, k.speed - ACCEL * dt) : k.speed - DRIFT_DRAG * dt;
      drift.charge += dt;
    } else if (brake && !k.brakeLatched) {
      // Brake wins over gas, also above top speed. Hard braking while rolling forward, gentler reverse from rest.
      k.speed = Math.max(-REVERSE_MAX, k.speed - (k.speed > 0 ? BRAKE_DECEL : ACCEL) * dt);
    } else if (k.speed > max) {
      k.speed = Math.max(max, k.speed - ACCEL * dt);
    } else if (input.gas) {
      k.speed = Math.min(max, k.speed + ACCEL * dt);
    } else {
      k.speed = approach(k.speed, 0, COAST_DECEL * dt);
    }
    const turnIn = drift.active ? driftTurn(steer) : steer;
    k.heading += turnIn * STEER_RATE * Math.min(1, Math.abs(k.speed) / 6) * Math.sign(k.speed) * dt;
  }

  // Grip: velocity chases the heading direction (loosely while drifting, so the kart slides).
  const fx = Math.sin(k.heading), fz = Math.cos(k.heading);
  const g = Math.min(1, (drift.active ? DRIFT_GRIP : GRIP) * dt);
  k.vel.x += (fx * k.speed - k.vel.x) * g;
  k.vel.z += (fz * k.speed - k.vel.z) * g;
  k.pos.x += k.vel.x * dt;
  k.pos.z += k.vel.z * dt;

  // Walls sit at the road edge, inset by the kart radius.
  const limit = track.width / 2 - KART_RADIUS;
  const pr = track.project(k.pos, k.trackIndex);
  k.trackIndex = pr.index;
  k.lateral = pr.lateral;
  if (Math.abs(pr.lateral) <= limit) {
    k.sinceWall += dt;
    return { hitWall: false };
  }
  k.sinceWall = 0;

  const h = track.headingAt(pr.s);
  const rx = Math.cos(h), rz = -Math.sin(h); // right of the track direction
  const side = Math.sign(pr.lateral);
  const push = side * limit - pr.lateral;
  k.lateral = side * limit;
  k.pos.x += rx * push;
  k.pos.z += rz * push;
  const vLat = k.vel.x * rx + k.vel.z * rz;
  // Speed of approach toward the wall (0 when already moving away).
  const vIn = Math.max(0, vLat * side);
  const f = Math.min(1, vIn / Math.max(1e-6, Math.hypot(k.vel.x, k.vel.z)));
  if (vIn > 0) {
    // Reflect the lateral component with restitution.
    k.vel.x -= rx * vLat * (1 + WALL_RESTITUTION);
    k.vel.z -= rz * vLat * (1 + WALL_RESTITUTION);
  }
  // Soft walls: speed loss and bump scale with impact; a scrape costs almost nothing.
  k.speed *= 1 - (1 - WALL_SPEED_KEEP) * f * f;
  // Scraping along a wall drags every step it lasts, so the walls are no guide rail.
  k.speed *= 1 - WALL_SCRAPE * dt;
  k.heading -= side * Math.min(0.3, f * 0.5);
  const hitWall = vIn > 0.5;
  if (hitWall && drift.active) endDrift(k, true); // bumping a wall loses the drift and its charge
  return { hitWall };
}

/** Separates overlapping karts and exchanges half their approach velocity. Returns ids of bumped pairs. */
export function resolveKartCollisions(karts: Kart[]): Array<[number, number]> {
  const bumped: Array<[number, number]> = [];
  const minDist = 2 * KART_RADIUS;
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      const d = dist(a.pos, b.pos);
      if (d >= minDist) continue;
      const n: Vec2 = d > 1e-9 ? { x: (b.pos.x - a.pos.x) / d, z: (b.pos.z - a.pos.z) / d } : { x: 1, z: 0 };
      const half = (minDist - d) / 2;
      a.pos.x -= n.x * half;
      a.pos.z -= n.z * half;
      b.pos.x += n.x * half;
      b.pos.z += n.z * half;
      const closing = dot(a.vel, n) - dot(b.vel, n);
      if (closing > 0) {
        // Swap 50% of the normal components: each moves halfway toward the other's.
        const dv = 0.5 * closing;
        a.vel.x -= n.x * dv;
        a.vel.z -= n.z * dv;
        b.vel.x += n.x * dv;
        b.vel.z += n.z * dv;
      }
      bumped.push([a.id, b.id]);
    }
  }
  return bumped;
}
