import { rankFraction } from '../odds';
import type { PowerupDef, PowerupEntity, WorldApi } from '../types';

/** Metres per second. Faster than a boosted kart (32 m/s), so it always catches up. */
const SPEED = 40;
/** It starts this far ahead of the shooter along the track. */
const START_AHEAD = 2;
/** Closer than this (m along the track) it stops following the track and flies straight at the target. */
const HOMING_GAP = 10;
/** Seconds before it gives up, with and without a target. */
const MAX_LIFE = 6;
const UNTARGETED_LIFE = 3;
/** Rounding slack for the timers. */
const EPS = 1e-9;

/**
 * Homes on the next kart ahead that is still racing. It flies 40 m/s along the track, drifting from the
 * shooter's lane to the target's, then for the last 10 m straight at the target (popping if that line
 * meets a wall). It spins the first kart it touches (never its owner), unless a shield takes the hit.
 * With nobody ahead, or once its target finishes the race, it flies straight on and pops at the wall or
 * after 3 s of that. It gives up after 6 s. Mostly for the back of the pack.
 */
export const rocket: PowerupDef = {
  id: 'rocket',
  name: 'Rocket',
  icon: '🚀',
  weight: (ctx) => 0.5 + 3 * rankFraction(ctx),
  use({ kart, world }) {
    const track = world.track;
    const ownerId = kart.id;
    /** Released (set to null) if it finishes the race mid-flight. */
    let target = world.kartAhead(kart);
    const startD = kart.distance + START_AHEAD;
    const startLateral = track.project(kart.pos, kart.trackIndex).lateral;
    /** Straight-flight direction: the shooter's heading, or the rocket's own when its target is released. */
    let fx = Math.sin(kart.heading), fz = Math.cos(kart.heading);
    /** Its own distance along the track (same scale as `kart.distance`). */
    let d = startD;
    let homing = false;
    let age = 0;
    /** Seconds of straight flight (without a target). */
    let straightAge = 0;
    /** Track sample near the rocket, so projecting it only searches nearby. */
    let hint = kart.trackIndex;
    const samples = track.points.length;

    const explode = (e: PowerupEntity, w: WorldApi): void => {
      w.sfx('rocket_explode');
      e.dead = true;
    };
    /** Pops the rocket if it has left the road (the walls stand at ±width/2). */
    const popOffRoad = (e: PowerupEntity, w: WorldApi): void => {
      const pr = track.project(e.pos, hint);
      hint = pr.index;
      if (Math.abs(pr.lateral) > track.width / 2) explode(e, w);
    };

    const shot: PowerupEntity = {
      pos: target
        ? track.pointAt(startD, startLateral)
        : { x: kart.pos.x + fx * START_AHEAD, z: kart.pos.z + fz * START_AHEAD },
      heading: target ? track.headingAt(startD) : kart.heading,
      look: { shape: 'cone', color: '#82B1FF', size: 1, y: 0.8, trail: '#FFC09F' },
      hitRadius: 1,
      dead: false,
      targetId: target ? target.id : undefined,
      update(dt, w) {
        age += dt;
        if (age >= MAX_LIFE - EPS) {
          this.dead = true;
          return;
        }
        const step = SPEED * dt;

        if (target && target.finishedAt !== null) {
          // Its target crossed the finish line: let it go and fly straight on.
          target = null;
          this.targetId = undefined;
          fx = Math.sin(this.heading);
          fz = Math.cos(this.heading);
        }

        if (!target) {
          // Nobody to chase: straight on until the wall or 3 s.
          straightAge += dt;
          this.pos.x += fx * step;
          this.pos.z += fz * step;
          if (straightAge >= UNTARGETED_LIFE - EPS) {
            this.dead = true;
            return;
          }
          popOffRoad(this, w);
          return;
        }

        if (!homing && target.distance - d < HOMING_GAP) homing = true;
        if (homing) {
          const dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z;
          const gap = Math.hypot(dx, dz);
          if (gap > 1e-6) {
            const t = Math.min(1, step / gap);
            this.pos.x += dx * t;
            this.pos.z += dz * t;
            this.heading = Math.atan2(dx, dz);
          }
          // The straight line can cut across a bend: never through a wall.
          popOffRoad(this, w);
          return;
        }

        // Along the track, easing from the shooter's lateral to the target's over the flight.
        d += step;
        const flown = d - startD;
        const left = Math.max(0, target.distance - d);
        const f = flown / (flown + left);
        const targetLateral = track.project(target.pos, target.trackIndex).lateral;
        const lateral = startLateral + (targetLateral - startLateral) * f;
        const p = track.pointAt(d, lateral);
        this.heading = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
        this.pos.x = p.x;
        this.pos.z = p.z;
        const s = ((d % track.length) + track.length) % track.length;
        hint = Math.min(samples - 1, Math.floor((s / track.length) * samples));
      },
      onHitKart(k, w) {
        if (k.id === ownerId) return;
        w.hitKart(k); // spins the kart, unless its shield takes the hit
        explode(this, w);
      },
    };
    world.spawnEntity(shot);
    world.sfx('rocket_fire');
  },
  botShouldUse({ kart, world }) {
    // Someone ahead and in range.
    const ahead = world.kartAhead(kart);
    if (ahead === null) return false;
    const gap = world.gapTo(kart, ahead);
    return gap > 0 && gap < 60;
  },
};
