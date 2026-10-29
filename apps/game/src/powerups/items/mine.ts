import { rankFraction } from '../odds';
import type { PowerupDef, PowerupEntity } from '../types';

/** Seconds a mine stays on the track. */
const LIFETIME = 30;
/** For this many seconds the kart that dropped it can't set it off; after that it catches anyone, its owner included. */
const OWNER_GRACE = 0.5;
/** Metres behind the kart's centre. */
const DROP_BEHIND = 2.5;
/** Rounding slack, so 1800 steps of 1/60 s end the 30 s exactly. */
const EPS = 1e-9;

/**
 * A little bomb dropped 2.5 m behind the kart. The first kart to touch it spins out (unless shielded) and
 * it is gone. The owner is safe for the first 0.5 s, then it can catch its owner too. Lasts 30 s.
 * Mostly for the front of the pack.
 */
export const mine: PowerupDef = {
  id: 'mine',
  name: 'Mine',
  icon: '💣',
  weight: (ctx) => 3 - 2 * rankFraction(ctx),
  use({ kart, world }) {
    const ownerId = kart.id;
    let age = 0;
    const bomb: PowerupEntity = {
      // Behind the kart: forward is (sin θ, cos θ).
      pos: { x: kart.pos.x - Math.sin(kart.heading) * DROP_BEHIND, z: kart.pos.z - Math.cos(kart.heading) * DROP_BEHIND },
      heading: kart.heading,
      look: { shape: 'sphere', color: '#FF8A80', size: 0.9, y: 0.45, accent: '#4A3A30' },
      hitRadius: 0.8,
      dead: false,
      update(dt) {
        age += dt;
        if (age >= LIFETIME - EPS) this.dead = true;
      },
      onHitKart(k, w) {
        if (k.id === ownerId && age < OWNER_GRACE) return;
        w.hitKart(k); // spins the kart, unless its shield takes the hit
        w.sfx('mine_explode');
        this.dead = true;
      },
    };
    world.spawnEntity(bomb);
    world.sfx('mine_drop');
  },
  botShouldUse({ kart, world }) {
    // Someone close behind to catch it.
    const behind = world.kartBehind(kart);
    return behind !== null && world.gapTo(kart, behind) > -15;
  },
};
