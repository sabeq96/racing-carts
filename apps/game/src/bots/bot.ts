import type { InputSnapshot } from '@rc/shared';
import type { Kart } from '../kart/kart';
import { BOOST_FACTOR, MAX_SPEED } from '../kart/tuning';
import { wrapAngle } from '../math/vec2';
import type { Track } from '../track/track';

/** Per-kart bot personality and state. Bots are relaxed: they cruise below top speed. */
export interface BotBrain {
  /** Fraction of MAX_SPEED the bot aims for (0.82-0.92). */
  speedFactor: number;
  /** Metres ahead on the track the bot steers toward. */
  lookahead: number;
  /** Lateral offset from the centre line (m, right is positive). */
  laneOffset: number;
  /** Seconds until the lane offset is re-picked. */
  laneTimer: number;
  /** Seconds the steering takes to follow what the bot wants (0.2-0.5), so it never turns on a dime. */
  reaction: number;
  /** Steering currently applied (smoothed by `reaction`). */
  steer: number;
}

const LANE_MAX = 3;
const LOOKAHEAD = 9;
/** Heading change over the lookahead (rad) at which the bot is slowed the most. */
const SHARP_TURN = 0.9;
/** Fraction of target speed given up in the sharpest turns. */
const CORNER_SLOWDOWN = 0.3;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const pickLaneOffset = (rand: () => number): number => (rand() * 2 - 1) * LANE_MAX;
const pickLaneTimer = (rand: () => number): number => 3 + rand() * 3;

export function createBotBrain(rand: () => number): BotBrain {
  return {
    speedFactor: 0.82 + rand() * 0.1,
    lookahead: LOOKAHEAD,
    laneOffset: pickLaneOffset(rand),
    laneTimer: pickLaneTimer(rand),
    reaction: 0.2 + rand() * 0.3,
    steer: 0,
  };
}

/** Racing-line driver: aim at a point `lookahead` ahead in the bot's own lane, ease off in sharp turns. */
export function botInput(b: BotBrain, k: Kart, track: Track, dt: number, rand: () => number): InputSnapshot {
  b.laneTimer -= dt;
  if (b.laneTimer <= 0) {
    b.laneOffset = pickLaneOffset(rand);
    b.laneTimer = pickLaneTimer(rand);
  }

  const s = track.project(k.pos, k.trackIndex).s;
  const target = track.pointAt(s + b.lookahead, b.laneOffset);
  const toTarget = Math.atan2(target.x - k.pos.x, target.z - k.pos.z); // heading θ points along (sinθ, cosθ)
  const want = clamp(2 * wrapAngle(toTarget - k.heading), -1, 1);
  // Steering follows the wish with a lag, so a bot reacts like a person rather than a robot.
  b.steer += (want - b.steer) * Math.min(1, dt / b.reaction);

  const turn = Math.abs(wrapAngle(track.headingAt(s + b.lookahead) - track.headingAt(s)));
  const corner = 1 - CORNER_SLOWDOWN * clamp(turn / SHARP_TURN, 0, 1);
  const boost = k.effects.some((e) => e.kind === 'boost');
  const targetSpeed = MAX_SPEED * b.speedFactor * corner * (boost ? BOOST_FACTOR : 1);

  return { steer: clamp(b.steer, -1, 1), gas: k.speed < targetSpeed, brake: false, item: false };
}
