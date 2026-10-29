import type { Kart } from '../kart/kart';
import { KART_RADIUS, SPIN_TIME } from '../kart/tuning';
import { compareRank } from '../race/progress';
import type { Track } from '../track/track';
import type { PowerupEntity, WorldApi } from './types';

/** The live powerup state of one race: entities on the track, timed effects, and queued sounds and hits. */
export interface World extends WorldApi {
  entities: PowerupEntity[];
  /** Entity updates, entity↔kart contacts (dist < hitRadius + KART_RADIUS), dead entities dropped, effects ticked. */
  step(dt: number): void;
  /** Sound names queued since the last drain. */
  drainSfx(): readonly string[];
  /** Ids of karts hit (not shielded) since the last drain. */
  drainHits(): readonly number[];
}

/** Returned by the drains when nothing happened, so a quiet frame allocates nothing. */
const NONE: readonly never[] = Object.freeze([]);
/** Rounding slack, so 60 steps of 1/60 s finish a 1 s timer in exactly 60 steps. */
const EPS = 1e-9;

export function createWorld(karts: Kart[], track: Track): World {
  let sounds: string[] = [];
  let hits: number[] = [];
  /** Race order, rebuilt in place on every kartAhead/kartBehind call. */
  const ranked: Kart[] = [];

  const rankIndex = (k: Kart): number => {
    ranked.length = 0;
    for (const x of karts) ranked.push(x);
    ranked.sort(compareRank);
    return ranked.indexOf(k);
  };

  const world: World = {
    karts,
    track,
    time: 0,
    entities: [],

    spawnEntity(e) {
      world.entities.push(e);
    },

    applyEffect(k, kind, seconds) {
      for (const e of k.effects) {
        if (e.kind === kind) {
          e.remaining = seconds; // using it again restarts the timer, it does not stack
          return;
        }
      }
      k.effects.push({ kind, remaining: seconds });
    },

    hasEffect(k, kind) {
      for (const e of k.effects) if (e.kind === kind) return true;
      return false;
    },

    removeEffect(k, kind) {
      for (let i = k.effects.length - 1; i >= 0; i--) if (k.effects[i].kind === kind) k.effects.splice(i, 1);
    },

    hitKart(k) {
      if (world.hasEffect(k, 'shield')) {
        world.removeEffect(k, 'shield');
        world.sfx('shield_break');
        return false;
      }
      k.spin = SPIN_TIME;
      k.speed *= 0.2;
      world.sfx('kart_spinout');
      hits.push(k.id);
      return true;
    },

    kartAhead(k) {
      const i = rankIndex(k);
      return i > 0 ? ranked[i - 1] : null;
    },

    kartBehind(k) {
      const i = rankIndex(k);
      return i >= 0 && i < ranked.length - 1 ? ranked[i + 1] : null;
    },

    gapTo(a, b) {
      return b.distance - a.distance;
    },

    sfx(name) {
      sounds.push(name);
    },

    step(dt) {
      world.time += dt;
      const list = world.entities;
      // Entities spawned during this step start moving next step.
      const n = list.length;
      for (let i = 0; i < n; i++) {
        const e = list[i];
        if (e.dead) continue;
        e.update(dt, world);
        if (!e.onHitKart) continue;
        for (const k of karts) {
          if (e.dead) break;
          const reach = e.hitRadius + KART_RADIUS;
          const dx = k.pos.x - e.pos.x, dz = k.pos.z - e.pos.z;
          if (dx * dx + dz * dz < reach * reach) e.onHitKart(k, world);
        }
      }
      let keep = 0;
      for (let i = 0; i < list.length; i++) if (!list[i].dead) list[keep++] = list[i];
      list.length = keep;

      for (const k of karts) {
        for (let i = k.effects.length - 1; i >= 0; i--) {
          const e = k.effects[i];
          e.remaining -= dt;
          if (e.remaining <= EPS) k.effects.splice(i, 1);
        }
      }
    },

    drainSfx() {
      if (sounds.length === 0) return NONE;
      const out = sounds;
      sounds = [];
      return out;
    },

    drainHits() {
      if (hits.length === 0) return NONE;
      const out = hits;
      hits = [];
      return out;
    },
  };
  return world;
}
