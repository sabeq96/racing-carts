import type { Kart } from '../kart/kart';
import type { Vec2 } from '../math/vec2';
import type { Track } from '../track/track';

/** Where the kart that hit an item box stands in the race. `position` is 1-based (1 = leader). */
export interface RollContext {
  position: number;
  racerCount: number;
}

/**
 * How render draws an entity (generically, no per-item render code): a simple pastel shape `size` metres
 * across, its centre at height `y` (default: resting on the ground), turned to `heading`.
 * Render reads the look once, when it creates the entity's mesh; changing it afterwards has no effect
 * (position and `heading` are read every frame).
 * - `sphere`, `box`: `size` across; `height` overrides the vertical size.
 * - `disc`: a flat cylinder `size` across and `height` thick (default 0.1): a puddle, a pad.
 * - `cone`: lying down, nose pointing along `heading`, `size` across at the base and 2 × `size` long.
 */
export interface EntityLook {
  shape: 'sphere' | 'cone' | 'box' | 'disc';
  color: string;
  size: number;
  height?: number;
  y?: number;
  /** Turns slowly in place instead of facing `heading`. */
  spin?: boolean;
  /** Colour of a small dot on top (a bomb's fuse, a button). */
  accent?: string;
  /** Colour of a short glowing puff behind it (opposite `heading`), for things that fly. */
  trail?: string;
}

/** Something an item left on the track (a mine, a rocket...). The world updates it every step. */
export interface PowerupEntity {
  pos: Vec2;
  heading: number;
  look: EntityLook;
  /** Touches a kart when the centres are closer than `hitRadius + KART_RADIUS`. */
  hitRadius: number;
  /** Set to true to have the world drop it at the end of the step. */
  dead: boolean;
  /** Id of the kart this entity homes in on, if any (bots raise a shield when targeted). */
  targetId?: number;
  update(dt: number, world: WorldApi): void;
  /** Called once per step for each kart it touches (until it sets `dead`). */
  onHitKart?(kart: Kart, world: WorldApi): void;
}

/** Everything an item may touch. Items only talk to the game through this. */
export interface WorldApi {
  karts: Kart[];
  track: Track;
  /** Seconds the world has been stepped. */
  time: number;
  entities: PowerupEntity[];
  spawnEntity(e: PowerupEntity): void;
  /** Starts (or restarts, never stacking or shortening) a timed effect; the kart physics reads `boost`, hits read `shield`. */
  applyEffect(k: Kart, kind: string, seconds: number): void;
  hasEffect(k: Kart, kind: string): boolean;
  removeEffect(k: Kart, kind: string): void;
  /**
   * Knocks the kart into a spin. Returns false if a shield absorbed it (the shield is used up, sfx
   * `shield_break`); true → spin = SPIN_TIME, speed × 0.2, sfx `kart_spinout`, phone `hit` event.
   */
  hitKart(k: Kart): boolean;
  /**
   * Nearest neighbours in race order (`rankKarts`) that are still racing (`finishedAt === null`), or null
   * when there is none. Finished karts rank first but are skipped: their `distance` is frozen at the line.
   */
  kartAhead(k: Kart): Kart | null;
  kartBehind(k: Kart): Kart | null;
  /** b.distance − a.distance: metres along the track from a to b (positive when b is ahead). */
  gapTo(a: Kart, b: Kart): number;
  /** Queues a sound by name (see the audio manifest); unknown names are ignored by the player. */
  sfx(name: string): void;
}

export interface UseContext {
  kart: Kart;
  world: WorldApi;
}

export interface BotContext {
  kart: Kart;
  world: WorldApi;
  /** Seconds the bot has held this item. */
  heldFor: number;
}

/** One powerup. Add a file under `items/` exporting one of these and list it in `registry.ts`. */
export interface PowerupDef {
  /** Stable id, sent to phones as `state.item`. */
  id: string;
  name: string;
  /** Emoji shown on the phone's item button and in the TV race list. */
  icon: string;
  /** Relative chance to roll it at this race position (≤ 0 = never). */
  weight(ctx: RollContext): number;
  /** Fires the item. The held item is already cleared when this runs. */
  use(ctx: UseContext): void;
  /** When a bot should fire it (default: as soon as the bot's hold delay has passed). */
  botShouldUse?(ctx: BotContext): boolean;
}
