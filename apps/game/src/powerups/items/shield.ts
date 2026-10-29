import { rankFraction } from '../odds';
import type { PowerupDef } from '../types';

/** A bubble that absorbs the next hit, or pops after 6 s. Mostly for the front of the pack. */
export const shield: PowerupDef = {
  id: 'shield',
  name: 'Shield',
  icon: '🛡️',
  weight: (ctx) => 3 - 2 * rankFraction(ctx),
  use({ kart, world }) {
    world.applyEffect(kart, 'shield', 6);
    world.sfx('shield_up');
  },
  botShouldUse({ kart, world, heldFor }) {
    if (heldFor > 5) return true;
    // Something homing in on us (a rocket): raise the shield now.
    for (const e of world.entities) if (!e.dead && e.targetId === kart.id) return true;
    return false;
  },
};
