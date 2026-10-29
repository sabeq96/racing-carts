import type { Kart } from '../kart/kart';
import type { WorldApi } from '../powerups/types';
import type { Track } from '../track/track';

/** Pad size along the road and across it (m). */
export const PAD_LENGTH = 4;
export const PAD_WIDTH = 4;
/** Seconds of boost a pad gives (refreshed, never stacked). */
export const PAD_BOOST = 1;
/** Per kart: a pad fires again only this long after the last one, so the sound never spams. */
export const PAD_COOLDOWN = 0.5;

const EPS = 1e-9;

/** The track's boost pads: a kart whose centre is on a pad gets a 1 s boost and a `boost` sound. */
export class BoostPads {
  /** Seconds left before each kart (by id) can fire a pad again. */
  private cooldown: number[] = [];
  /** Each pad's forward and right directions, so a contact test is two dot products. */
  private axes: { fx: number; fz: number; rx: number; rz: number }[];

  constructor(private readonly track: Track) {
    this.axes = track.boostPads.map((p) => ({
      fx: Math.sin(p.heading),
      fz: Math.cos(p.heading),
      rx: Math.cos(p.heading),
      rz: -Math.sin(p.heading),
    }));
  }

  update(dt: number, karts: Kart[], world: Pick<WorldApi, 'applyEffect' | 'sfx'>): void {
    const pads = this.track.boostPads;
    const cooldown = this.cooldown;
    for (const k of karts) {
      while (cooldown.length <= k.id) cooldown.push(0);
      if (cooldown[k.id] > 0) cooldown[k.id] -= dt;
      if (cooldown[k.id] > EPS) continue;
      for (let i = 0; i < pads.length; i++) {
        const a = this.axes[i];
        const dx = k.pos.x - pads[i].pos.x, dz = k.pos.z - pads[i].pos.z;
        // The road is straight enough over 4 m that the pad's own frame stands in for s / lateral.
        if (Math.abs(dx * a.fx + dz * a.fz) > PAD_LENGTH / 2 || Math.abs(dx * a.rx + dz * a.rz) > PAD_WIDTH / 2) continue;
        world.applyEffect(k, 'boost', PAD_BOOST);
        world.sfx('boost');
        cooldown[k.id] = PAD_COOLDOWN;
        break;
      }
    }
  }
}
