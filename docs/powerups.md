# Powerups

Everything lives in `apps/game/src/powerups/`. It is plain TypeScript with no Babylon:

| File | What it does |
| --- | --- |
| `types.ts` | `PowerupDef`, `WorldApi`, `PowerupEntity` and the contexts passed to them |
| `registry.ts` | `POWERUPS`, the list of every item, and `getPowerup(id)` |
| `items/*.ts` | One file per item: `shield.ts`, `boost.ts`, `mine.ts`, `rocket.ts` |
| `odds.ts` | `rankFraction(ctx)`: 0 for the leader, 1 for last |
| `roll.ts` | `rollItem`: a weighted pick from `POWERUPS` |
| `itemBoxes.ts` | Box pickup, the 1 s roll and the 3 s respawn |
| `useItem.ts` | The item button. Only a fresh press fires the held item |
| `world.ts` | Entities on the track, timed effects (`kart.effects`), hits, and the sound and hit queues |

Drawing lives outside, in `apps/game/src/render/entityViews.ts`. It builds one mesh per entity in
`world.entities` from the entity's `look`, with a blob shadow under it, and disposes it when the entity is gone.
It has no per-item code.

The game owns one `World` and one `ItemBoxes`, and `Game.setupKarts` replaces both at every start and
rematch. Each fixed step runs in this order: inputs, item presses, kart physics, kart collisions,
item boxes, `world.step` (which moves entities, checks entity-kart contacts and ticks effects), then the race.

## Adding a powerup

1. Create `apps/game/src/powerups/items/<name>.ts` that exports a `PowerupDef`. This example is an oil
   slick that the kart drops behind itself. It spins the first kart that drives over it, then disappears.
   Its owner is safe for the first 0.5 s, so it can drive off; after that the slick catches its owner too
   (`mine.ts` works the same way):
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
and `render/entityViews.ts` draws its entities from their `look`.

What `use` can do, all through `WorldApi`:
- **Timed effects:** `applyEffect`, `hasEffect` and `removeEffect`. Using an effect again restarts its timer.
- **Hits:** `hitKart(k)` spins a kart for 1.2 s and tells its phone, unless a shield absorbs the hit.
- **Things on the track:** `spawnEntity(e)`. An entity needs `update(dt, world)`, a `look`, a `hitRadius` and
  optionally `onHitKart`. The `look` (`EntityLook` in `types.ts`) is all render needs: a `sphere`, `box`,
  `disc` or `cone` in a pastel `color`, `size` across, at height `y`. A cone lies down with its nose along the
  entity's `heading`, so keep `heading` pointing where the entity moves (see `rocket.ts`). Optional extras are
  `spin`, an `accent` dot on top (the mine's fuse) and a glowing `trail` behind (the rocket's exhaust).
  `onHitKart` runs for *every* kart it touches, owner included, so the entity decides about its owner itself
  (the mine spares it for 0.5 s, the rocket always). Set `dead = true` to remove the entity. Give it `targetId` if it homes in on a kart;
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
- **A new entity shape** beyond `sphere`, `cone`, `box` and `disc` needs adding to `EntityLook` in `types.ts`
  and a case in `EntityViews.build` (`render/entityViews.ts`).

Tests: `powerups.test.ts` shows how to add a temporary def to `POWERUPS` and remove it again; `items.test.ts`
drives the mine and the rocket through a real world, and `render/entityViews.test.ts` checks the generic drawing.
