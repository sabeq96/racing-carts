import type { WorldApi } from '../powerups/types';
import type { Kart } from './kart';

/** Drafting window behind the next racing kart: gap along the track (m), sideways offset (m), speed (m/s). */
export const DRAFT_MIN_GAP = 2;
export const DRAFT_MAX_GAP = 12;
export const DRAFT_LATERAL = 2.5;
export const DRAFT_MIN_SPEED = 8;
/** Seconds of drafting that pay a DRAFT_BOOST-second boost; out of the window the draft drains twice as fast. */
export const DRAFT_TIME = 1;
export const DRAFT_BOOST = 0.8;
const DRAFT_DECAY = 2;
const EPS = 1e-9;

type SlipWorld = Pick<WorldApi, 'track' | 'kartAhead' | 'applyEffect' | 'sfx'>;

/** Whether `k` sits in the slipstream of the next kart still racing ahead of it. */
function inSlipstream(k: Kart, world: SlipWorld): boolean {
  if (k.finishedAt !== null || k.speed <= DRAFT_MIN_SPEED) return false;
  const ahead = world.kartAhead(k); // unfinished karts only
  if (!ahead || ahead.speed <= DRAFT_MIN_SPEED) return false;
  const gap = ahead.distance - k.distance;
  if (gap < DRAFT_MIN_GAP || gap > DRAFT_MAX_GAP) return false;
  const track = world.track;
  const side = track.project(ahead.pos, ahead.trackIndex).lateral - track.project(k.pos, k.trackIndex).lateral;
  return Math.abs(side) < DRAFT_LATERAL;
}

/** Charges each kart's `draft` while it tucks in behind the kart ahead; a full draft pays a short boost. */
export function stepSlipstream(karts: Kart[], world: SlipWorld, dt: number): void {
  for (const k of karts) {
    if (k.finishedAt !== null) {
      k.draft = 0;
    } else if (inSlipstream(k, world)) {
      k.draft += dt;
      if (k.draft >= DRAFT_TIME - EPS) {
        world.applyEffect(k, 'boost', DRAFT_BOOST);
        world.sfx('boost');
        k.draft = 0;
      }
    } else {
      k.draft = Math.max(0, k.draft - DRAFT_DECAY * dt);
    }
  }
}
