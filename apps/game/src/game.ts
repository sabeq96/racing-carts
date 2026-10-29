import { KART_COLORS, NEUTRAL_INPUT, type InputSnapshot } from '@rc/shared';
import { createKart, resolveKartCollisions, stepKart, type Kart } from './kart/kart';
import { Race, type RaceEvent } from './race/race';
import type { Track } from './track/track';

export interface Driver {
  kind: 'human' | 'bot';
  name: string;
  input(): InputSnapshot;
}

/** Owns the simulation: karts, physics and race rules. No rendering here. */
export class Game {
  track: Track;
  karts: Kart[] = [];
  race = new Race();
  /** Human kart ids as of the latest step; reused so the render loop allocates nothing. */
  private humanIds: number[] = [];
  private readonly isHuman = (id: number): boolean => this.humanIds.indexOf(id) >= 0;

  constructor(track: Track) {
    this.track = track;
  }

  /** Creates fresh karts on grid slots 0..n-1 (capped at the grid size) in slot colours. */
  setupKarts(slotCount: number): void {
    const n = Math.max(0, Math.min(slotCount, this.track.grid.length, KART_COLORS.length));
    this.karts = Array.from({ length: n }, (_, i) =>
      createKart(i, KART_COLORS[i], this.track.grid[i], this.track),
    );
  }

  /** One fixed step: inputs → physics → kart collisions → race (progress, laps, phases). */
  step(dt: number, drivers: (kartId: number) => Driver): RaceEvent[] {
    const racing = this.race.phase === 'racing';
    this.humanIds.length = 0;
    for (const k of this.karts) {
      const driver = drivers(k.id);
      if (driver.kind === 'human') this.humanIds.push(k.id);
      stepKart(k, racing ? driver.input() : NEUTRAL_INPUT, this.track, dt);
    }
    resolveKartCollisions(this.karts);
    return this.race.update(dt, this.karts, this.track, this.isHuman);
  }

  /** Ids of karts driven by humans, per the drivers passed to the latest `step` (a live, shared array). */
  humanKartIds(): readonly number[] {
    return this.humanIds;
  }
}
