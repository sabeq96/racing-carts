/**
 * Every powerup the game knows. Item boxes roll from this list, item presses look ids up here.
 *
 * Adding a powerup (docs/powerups.md has a full example, an oil slick):
 *   1. Create `items/<name>.ts` exporting a `PowerupDef` (see `types.ts`): `id`, `name`, emoji `icon`,
 *      `weight(ctx)` (use `rankFraction(ctx)` from `odds.ts`: 0 = leader, 1 = last), and `use({ kart, world })`.
 *      `use` acts only through `WorldApi`: `applyEffect`, `hitKart`, `spawnEntity` (an entity with `update`,
 *      a `look`, and `onHitKart` to touch karts, deciding about its owner itself) and `sfx`.
 *      Optional `botShouldUse(ctx)` decides when bots fire it.
 *   2. Add it to `POWERUPS` below. Rolls, phone and TV icons, and bots then pick it up.
 * Beyond one file: a new sfx name needs `public/audio/<name>.mp3` and a manifest entry. A new effect kind
 * needs a reader (`stepKart` or the world), and optionally a visual in `render/kartViews.ts`.
 */
import { boost } from './items/boost';
import { mine } from './items/mine';
import { rocket } from './items/rocket';
import { shield } from './items/shield';
import type { PowerupDef } from './types';

/** Mutable on purpose, so tests can add a temporary def (and remove it afterwards). */
export const POWERUPS: PowerupDef[] = [shield, boost, mine, rocket];

export function getPowerup(id: string): PowerupDef | undefined {
  for (const d of POWERUPS) if (d.id === id) return d;
  return undefined;
}
