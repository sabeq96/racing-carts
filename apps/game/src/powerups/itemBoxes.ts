import type { Kart } from '../kart/kart';
import { KART_RADIUS } from '../kart/tuning';
import type { Vec2 } from '../math/vec2';
import { compareRank } from '../race/progress';
import type { Track } from '../track/track';
import { rollItem } from './roll';
import type { World } from './world';

/** A kart within this many metres of a box centre takes it. */
export const BOX_PICKUP_RADIUS = 1.5 + KART_RADIUS;
/** Seconds a taken box stays hidden. */
export const BOX_RESPAWN = 3;
/** Seconds the item roulette spins before the item lands. */
export const ROLL_TIME = 1;

const EPS = 1e-9;
const NONE: readonly never[] = Object.freeze([]);

/** The item boxes on the track: driving through one starts a 1 s roll, the box hides for 3 s. */
export class ItemBoxes {
  /** `respawn > 0` = hidden for that many more seconds. */
  boxes: { pos: Vec2; respawn: number }[];
  private got: number[] = [];
  private ranked: Kart[] = [];

  constructor(track: Track) {
    this.boxes = track.itemBoxes.map((p) => ({ pos: { x: p.x, z: p.z }, respawn: 0 }));
  }

  /** Ticks rolls and hidden boxes, then hands out boxes. Returns ids of karts whose roll finished (→ `itemGot`). */
  update(dt: number, karts: Kart[], world: World, rand: () => number): readonly number[] {
    for (const b of this.boxes) {
      if (b.respawn > 0) b.respawn = b.respawn - dt <= EPS ? 0 : b.respawn - dt;
    }
    for (const k of karts) {
      const r = k.rolling;
      if (!r) continue;
      r.left -= dt;
      if (r.left <= EPS) {
        k.item = r.item;
        k.rolling = null;
        this.got.push(k.id);
      }
    }

    const reach2 = BOX_PICKUP_RADIUS * BOX_PICKUP_RADIUS;
    for (const b of this.boxes) {
      if (b.respawn > 0) continue;
      for (const k of karts) {
        const dx = k.pos.x - b.pos.x, dz = k.pos.z - b.pos.z;
        if (dx * dx + dz * dz >= reach2) continue;
        // The box pops either way; only an empty-handed kart gets a roll.
        b.respawn = BOX_RESPAWN;
        world.sfx('item_box_pickup');
        if (k.item === null && k.rolling === null) {
          k.rolling = { left: ROLL_TIME, item: rollItem({ position: this.positionOf(k, karts), racerCount: karts.length }, rand) };
          world.sfx('item_roulette');
        }
        break;
      }
    }

    if (this.got.length === 0) return NONE;
    const out = this.got;
    this.got = [];
    return out;
  }

  private positionOf(k: Kart, karts: Kart[]): number {
    const ranked = this.ranked;
    ranked.length = 0;
    for (const x of karts) ranked.push(x);
    ranked.sort(compareRank);
    return ranked.indexOf(k) + 1;
  }
}
