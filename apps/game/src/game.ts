import { KART_COLORS, NEUTRAL_INPUT, type InputSnapshot } from '@rc/shared';
import { createKart, resolveKartCollisions, stepKart, type Kart } from './kart/kart';
import { ItemBoxes } from './powerups/itemBoxes';
import { BoostPads } from './race/boostPads';
import { handleItemInput } from './powerups/useItem';
import { createWorld, type World } from './powerups/world';
import { Race, type RaceEvent } from './race/race';
import type { Track } from './track/track';

/** Returned by `drainItemGot` on quiet steps, so they allocate nothing. */
const NO_IDS: readonly never[] = Object.freeze([]);

export interface Driver {
  kind: 'human' | 'bot';
  name: string;
  input(): InputSnapshot;
}

/** Owns the simulation: karts, physics, powerups and race rules. No rendering here. */
export class Game {
  track: Track;
  karts: Kart[] = [];
  race = new Race();
  /** Powerup entities, effects, sounds and hits for the current karts (replaced by `setupKarts`). */
  world: World;
  itemBoxes: ItemBoxes;
  boostPads: BoostPads;
  /** Human kart ids as of the latest step; reused so the render loop allocates nothing. */
  private humanIds: number[] = [];
  private readonly isHuman = (id: number): boolean => this.humanIds.indexOf(id) >= 0;
  /** Each kart's input for the current step, reused. */
  private inputs: InputSnapshot[] = [];
  /** Kart ids whose item roll finished since the last `drainItemGot`. */
  private itemGot: number[] = [];
  /** Kart ids that hit a wall / were bumped by another kart since the last drain (for sounds). */
  private wallHits: number[] = [];
  private bumps: number[] = [];

  constructor(track: Track, private readonly rand: () => number = Math.random) {
    this.track = track;
    this.world = createWorld(this.karts, track);
    this.itemBoxes = new ItemBoxes(track);
    this.boostPads = new BoostPads(track);
  }

  /**
   * Creates fresh karts on grid slots 0..n-1 (capped at the grid size) in slot colours, with no items or
   * effects, and resets the powerup world and item boxes (every race start and rematch comes through here).
   */
  setupKarts(slotCount: number): void {
    const n = Math.max(0, Math.min(slotCount, this.track.grid.length, KART_COLORS.length));
    this.karts = Array.from({ length: n }, (_, i) =>
      createKart(i, KART_COLORS[i], this.track.grid[i], this.track),
    );
    this.world = createWorld(this.karts, this.track);
    this.itemBoxes = new ItemBoxes(this.track);
    this.boostPads = new BoostPads(this.track);
    this.itemGot.length = 0;
    this.wallHits.length = 0;
    this.bumps.length = 0;
  }

  /**
   * One fixed step: inputs → item presses → physics → kart collisions → item boxes → boost pads →
   * powerup world (entities, effects) → race (progress, laps, phases). Inputs, items included, only count
   * while racing.
   */
  step(dt: number, drivers: (kartId: number) => Driver): RaceEvent[] {
    const racing = this.race.phase === 'racing';
    const karts = this.karts;
    const inputs = this.inputs;
    inputs.length = karts.length;
    this.humanIds.length = 0;
    for (let i = 0; i < karts.length; i++) {
      const driver = drivers(karts[i].id);
      if (driver.kind === 'human') this.humanIds.push(karts[i].id);
      inputs[i] = racing ? driver.input() : NEUTRAL_INPUT;
    }
    for (let i = 0; i < karts.length; i++) handleItemInput(karts[i], inputs[i].item, this.world);
    for (let i = 0; i < karts.length; i++) {
      if (stepKart(karts[i], inputs[i], this.track, dt).hitWall) this.wallHits.push(karts[i].id);
    }
    for (const [a, b] of resolveKartCollisions(karts)) this.bumps.push(a, b);
    const got = this.itemBoxes.update(dt, karts, this.world, this.rand);
    for (const id of got) this.itemGot.push(id);
    this.boostPads.update(dt, karts, this.world);
    this.world.step(dt);
    return this.race.update(dt, karts, this.track, this.isHuman);
  }

  /** Kart ids whose item roll finished since the last call (each → an `itemGot` event to that phone). */
  drainItemGot(): readonly number[] {
    if (this.itemGot.length === 0) return NO_IDS;
    const out = this.itemGot;
    this.itemGot = [];
    return out;
  }

  /** Ids of karts that hit a wall since the last call (an id repeats per hit). */
  drainWallHits(): readonly number[] {
    if (this.wallHits.length === 0) return NO_IDS;
    const out = this.wallHits;
    this.wallHits = [];
    return out;
  }

  /** Ids of karts that bumped another kart since the last call (both karts of a pair; an id repeats per bump). */
  drainKartBumps(): readonly number[] {
    if (this.bumps.length === 0) return NO_IDS;
    const out = this.bumps;
    this.bumps = [];
    return out;
  }

  /** Ids of karts driven by humans, per the drivers passed to the latest `step` (a live, shared array). */
  humanKartIds(): readonly number[] {
    return this.humanIds;
  }
}
