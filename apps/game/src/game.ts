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
  private drivers: ((kartId: number) => Driver) | null = null;

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
    this.drivers = drivers;
    const racing = this.race.phase === 'racing';
    for (const k of this.karts) {
      const input = racing ? drivers(k.id).input() : NEUTRAL_INPUT;
      stepKart(k, input, this.track, dt);
    }
    resolveKartCollisions(this.karts);
    return this.race.update(dt, this.karts, this.track, (id) => drivers(id).kind === 'human');
  }

  /** Ids of karts driven by humans, per the drivers passed to the latest `step`. */
  humanKartIds(): number[] {
    const drivers = this.drivers;
    if (!drivers) return [];
    return this.karts.filter((k) => drivers(k.id).kind === 'human').map((k) => k.id);
  }
}
