import type { InputSnapshot } from '@rc/shared';
import { Vec2, dist, dot } from '../math/vec2';
import type { Track } from '../track/track';
import {
  ACCEL,
  BOOST_FACTOR,
  BRAKE_DECEL,
  COAST_DECEL,
  GRIP,
  KART_RADIUS,
  MAX_SPEED,
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
  finishedAt: number | null;
}

export function createKart(id: number, color: string, slot: Track['grid'][number], track: Track): Kart {
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
    trackIndex: track.project(slot.pos).index,
    finishedAt: null,
  };
}

/** Seconds left on the kart's `kind` effect (0 when it has none). Allocation-free, for per-frame reads. */
export function effectLeft(k: Kart, kind: string): number {
  for (const e of k.effects) if (e.kind === kind) return e.remaining;
  return 0;
}

/** Move `v` toward `target` by at most `step` (never overshooting). */
function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

export function stepKart(k: Kart, input: InputSnapshot, track: Track, dt: number): { hitWall: boolean } {
  if (k.spin > 0) {
    k.spin = Math.max(0, k.spin - dt);
    k.speed *= Math.exp(-3 * dt);
    k.heading += 10 * dt;
  } else {
    const boost = effectLeft(k, 'boost') > 0;
    const max = MAX_SPEED * (boost ? BOOST_FACTOR : 1);
    if (k.speed > max) {
      k.speed = Math.max(max, k.speed - ACCEL * dt);
    } else if (input.brake) {
      // Brake wins over gas. Hard braking while rolling forward, gentler reverse acceleration from rest.
      k.speed = Math.max(-REVERSE_MAX, k.speed - (k.speed > 0 ? BRAKE_DECEL : ACCEL) * dt);
    } else if (input.gas) {
      k.speed = Math.min(max, k.speed + ACCEL * dt);
    } else {
      k.speed = approach(k.speed, 0, COAST_DECEL * dt);
    }
    const steer = Math.max(-1, Math.min(1, input.steer));
    k.heading += steer * STEER_RATE * Math.min(1, Math.abs(k.speed) / 6) * Math.sign(k.speed) * dt;
  }

  // Grip: velocity chases the heading direction.
  const fx = Math.sin(k.heading), fz = Math.cos(k.heading);
  const g = Math.min(1, GRIP * dt);
  k.vel.x += (fx * k.speed - k.vel.x) * g;
  k.vel.z += (fz * k.speed - k.vel.z) * g;
  k.pos.x += k.vel.x * dt;
  k.pos.z += k.vel.z * dt;

  // Walls sit at the road edge, inset by the kart radius.
  const limit = track.width / 2 - KART_RADIUS;
  const pr = track.project(k.pos, k.trackIndex);
  k.trackIndex = pr.index;
  if (Math.abs(pr.lateral) <= limit) return { hitWall: false };

  const h = track.headingAt(pr.s);
  const rx = Math.cos(h), rz = -Math.sin(h); // right of the track direction
  const side = Math.sign(pr.lateral);
  const push = side * limit - pr.lateral;
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
  return { hitWall: vIn > 0.5 };
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
