/**
 * Every powerup the game knows. Item boxes roll from this list, item presses look ids up here.
 *
 * Adding a powerup:
 *   1. Create `items/<name>.ts` exporting a `PowerupDef` (see `types.ts`): an `id`, `name`, emoji `icon`,
 *      a `weight(ctx)` (use `rankFraction(ctx)` from `odds.ts`: 0 = leader, 1 = last) and `use({ kart, world })`.
 *   2. Add it to `POWERUPS` below. That is all: rolls, the phone icon, the TV race list and bots pick it up.
 *   `use` talks to the game only through `WorldApi`: timed effects (`applyEffect`), `hitKart`, `spawnEntity`
 *   for things on the track (they need `update`, and `onHitKart` to touch karts), and `sfx` for sounds.
 *   Optional `botShouldUse(ctx)` says when a bot fires it (default: as soon as it has held it a moment).
 *   A new effect kind only does something if code reads it (e.g. `stepKart` reads `boost`).
 *   More detail: docs/powerups.md.
 */
import { boost } from './items/boost';
import { shield } from './items/shield';
import type { PowerupDef } from './types';

/** Mutable on purpose, so tests can add a temporary def (and remove it afterwards). */
export const POWERUPS: PowerupDef[] = [shield, boost];

export function getPowerup(id: string): PowerupDef | undefined {
  for (const d of POWERUPS) if (d.id === id) return d;
  return undefined;
}
