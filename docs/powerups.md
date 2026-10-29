# Powerups

Everything lives in `apps/game/src/powerups/`. It is plain TypeScript with no Babylon:

| File | What it does |
| --- | --- |
| `types.ts` | `PowerupDef`, `WorldApi`, `PowerupEntity` and the contexts passed to them |
| `registry.ts` | `POWERUPS`, the list of every item, and `getPowerup(id)` |
| `items/*.ts` | One file per item (`shield.ts`, `boost.ts`, ...) |
| `odds.ts` | `rankFraction(ctx)`: 0 for the leader, 1 for last |
| `roll.ts` | `rollItem`: a weighted pick from `POWERUPS` |
| `itemBoxes.ts` | Box pickup, the 1 s roll and the 3 s respawn |
| `useItem.ts` | The item button. Only a fresh press fires the held item |
| `world.ts` | Entities on the track, timed effects (`kart.effects`), hits, and the sound and hit queues |

The game owns one `World` and one `ItemBoxes`, and `Game.setupKarts` replaces both at every start and
rematch. Each fixed step runs in this order: inputs, item presses, kart physics, kart collisions,
item boxes, `world.step` (which moves entities, checks entity-kart contacts and ticks effects), then the race.

## Adding a powerup

1. Create `apps/game/src/powerups/items/<name>.ts` that exports a `PowerupDef`:
   ```ts
   import { rankFraction } from '../odds';
   import type { PowerupDef } from '../types';

   export const magnet: PowerupDef = {
     id: 'magnet',          // stable id; phones receive it as state.item
     name: 'Magnet',
     icon: '🧲',            // shown on the phone button and in the TV race list
     weight: (ctx) => 0.5 + 2 * rankFraction(ctx),   // a higher weight means more likely to roll
     use({ kart, world }) {
       world.applyEffect(kart, 'magnet', 3);
       world.sfx('magnet');
     },
     botShouldUse: ({ heldFor }) => heldFor > 2,     // optional; by default bots fire it right away
   };
   ```
2. Add it to `POWERUPS` in `registry.ts`.

That is all. Item boxes roll it, the item button fires it, the phone and the TV show its icon, and bots use it.

What `use` can do, all through `WorldApi`:
- **Timed effects:** `applyEffect`, `hasEffect` and `removeEffect`. Using an effect again restarts its timer.
  An effect only changes something if some code reads it. `stepKart` reads `boost`, and `hitKart` reads `shield`.
- **Hits:** `hitKart(k)` spins a kart for 1.2 s and tells its phone, unless a shield absorbs the hit.
- **Things on the track:** `spawnEntity(e)` with `update(dt, world)`, an `EntityLook` for render, a `hitRadius`,
  and an optional `onHitKart`. Set `dead = true` to remove the entity. Give it `targetId` if it homes in
  on a kart; a bot that holds a shield then raises it.
- **Race order:** `kartAhead`, `kartBehind` and `gapTo`.
- **Sound:** `sfx(name)`. The name should exist in the audio manifest; unknown names are ignored.

Tests: `powerups.test.ts` shows how to add a temporary def to `POWERUPS` and remove it again.
