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

1. Create `apps/game/src/powerups/items/<name>.ts` that exports a `PowerupDef`. This example is an oil
   slick that the kart drops behind itself. It spins the first other kart that drives over it, then disappears:
   ```ts
   import { rankFraction } from '../odds';
   import type { PowerupDef, PowerupEntity } from '../types';

   const LIFETIME = 20; // seconds on the track
   const OWNER_GRACE = 0.5; // the kart that dropped it drives off it unharmed

   export const oil: PowerupDef = {
     id: 'oil', // stable id; phones receive it as state.item
     name: 'Oil slick',
     icon: '🛢️', // shown on the phone button and in the TV race list
     weight: (ctx) => 2 - rankFraction(ctx), // a higher weight means more likely to roll; this one is more likely near the front
     use({ kart, world }) {
       const ownerId = kart.id;
       let age = 0;
       const slick: PowerupEntity = {
         // 2.5 m behind the kart: forward is (sin θ, cos θ).
         pos: { x: kart.pos.x - Math.sin(kart.heading) * 2.5, z: kart.pos.z - Math.cos(kart.heading) * 2.5 },
         heading: kart.heading,
         look: { shape: 'disc', color: '#5B4A44', size: 2.4, height: 0.05, y: 0.03 },
         hitRadius: 1,
         dead: false,
         update(dt) {
           age += dt;
           if (age >= LIFETIME) this.dead = true;
         },
         onHitKart(k, w) {
           if (k.id === ownerId && age < OWNER_GRACE) return;
           w.hitKart(k); // spins the kart, unless its shield takes the hit
           w.sfx('oil_splat');
           this.dead = true;
         },
       };
       world.spawnEntity(slick);
       world.sfx('oil_drop');
     },
     // Optional: when a bot fires it (by default, as soon as it has held it for a moment).
     botShouldUse({ kart, world }) {
       const behind = world.kartBehind(kart);
       return behind !== null && world.gapTo(kart, behind) > -15;
     },
   };
   ```
2. Add it to `POWERUPS` in `registry.ts`.

That is all. Item boxes roll it, the item button fires it, the phone and the TV show its icon, bots use it,
and render draws its entities from their `look`.

What `use` can do, all through `WorldApi`:
- **Timed effects:** `applyEffect`, `hasEffect` and `removeEffect`. Using an effect again restarts its timer.
- **Hits:** `hitKart(k)` spins a kart for 1.2 s and tells its phone, unless a shield absorbs the hit.
- **Things on the track:** `spawnEntity(e)`. An entity needs `update(dt, world)`, a `look`, a `hitRadius` and
  optionally `onHitKart`. `onHitKart` runs for *every* kart it touches, owner included, so it must skip
  its owner itself. Set `dead = true` to remove the entity. Give it `targetId` if it homes in on a kart;
  a bot that holds a shield then raises it.
- **Race order:** `kartAhead`, `kartBehind` and `gapTo`.
- **Sound:** `sfx(name)`.

## When you need more than one file

- **A new sound name** (like `oil_drop` above) needs `apps/game/public/audio/<name>.mp3` and an entry in
  the audio manifest (`apps/game/src/audio/manifest.ts`). Until then the name plays nothing; it is
  ignored, not an error.
- **A new effect kind** (anything passed to `applyEffect` besides `boost` and `shield`) only does something if
  code reads it. Add the reader where it belongs: kart physics (`stepKart`, which reads `boost`) or the
  world (`hitKart`, which reads `shield`). You can also add a visual for it in `render/kartViews.ts`, the
  way the shield bubble and the boost flame are drawn.
- **A new entity shape** beyond `sphere`, `cone`, `box` and `disc` needs a case in `render/entityViews.ts`.

Tests: `powerups.test.ts` shows how to add a temporary def to `POWERUPS` and remove it again.
