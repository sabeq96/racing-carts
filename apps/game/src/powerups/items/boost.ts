import { wrapAngle } from '../../math/vec2';
import { rankFraction } from '../odds';
import type { PowerupDef } from '../types';

/** +60 % top speed for 1.5 s (the kart physics reads the `boost` effect). Mostly for the back of the pack. */
export const boost: PowerupDef = {
  id: 'boost',
  name: 'Boost',
  icon: '⚡',
  weight: (ctx) => 1 + 3 * rankFraction(ctx),
  use({ kart, world }) {
    world.applyEffect(kart, 'boost', 1.5);
    world.sfx('boost');
  },
  botShouldUse({ kart, world }) {
    // Only with a straight ahead, so the bot does not boost into a wall.
    const track = world.track;
    const s = track.project(kart.pos, kart.trackIndex).s;
    return Math.abs(wrapAngle(track.headingAt(s + 20) - track.headingAt(s))) < 0.15;
  },
};
