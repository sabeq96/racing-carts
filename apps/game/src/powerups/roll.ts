import { POWERUPS } from './registry';
import type { PowerupDef, RollContext } from './types';

/** Weighted random pick of an item id for a kart at this race position. Weights ≤ 0 never win. */
export function rollItem(ctx: RollContext, rand: () => number, defs: PowerupDef[] = POWERUPS): string {
  let total = 0;
  for (const d of defs) total += Math.max(0, d.weight(ctx));
  let r = rand() * total;
  // If no def has a positive weight (say every item is disabled at this position), the box still gives
  // something rather than an empty roll: the first def, so a kart that drove through a box is never cheated.
  let last = defs.length > 0 ? defs[0].id : '';
  for (const d of defs) {
    const w = Math.max(0, d.weight(ctx));
    if (w <= 0) continue;
    if (r < w) return d.id;
    r -= w;
    last = d.id; // rounding can leave r a hair above the final weight
  }
  return last;
}
