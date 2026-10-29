import { TOTAL_LAPS, type Phase } from '@rc/shared';
import type { Kart } from '../kart/kart';
import type { Track } from '../track/track';
import { isFinished, lapOf, updateProgress } from './progress';

export type RaceEvent =
  | { kind: 'countdown'; n: 3 | 2 | 1 }
  | { kind: 'go' }
  | { kind: 'lap'; kartId: number; lap: number }
  | { kind: 'finalLap'; kartId: number }
  | { kind: 'finish'; kartId: number; place: number }
  | { kind: 'results' };

const COUNTDOWN_SECONDS = 3;
/** Seconds after the first human finishes before the race is called. */
const FINISH_GRACE = 30;
const EPS = 1e-9;

export class Race {
  phase: Phase = 'lobby';
  /** Seconds since GO. */
  time = 0;
  private countdownLeft = COUNTDOWN_SECONDS;
  private nextCount: 3 | 2 | 1 | 0 = 3;
  private finishCount = 0;
  /** Highest lap already announced per kart, so dithering across the line never repeats events. */
  private announcedLap = new Map<number, number>();
  private firstHumanFinishedAt: number | null = null;

  start(): void {
    if (this.phase !== 'lobby' && this.phase !== 'results') return;
    this.phase = 'countdown';
    this.time = 0;
    this.countdownLeft = COUNTDOWN_SECONDS;
    this.nextCount = 3;
    this.finishCount = 0;
    this.announcedLap.clear();
    this.firstHumanFinishedAt = null;
  }

  update(dt: number, karts: Kart[], track: Track, isHuman: (kartId: number) => boolean): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (this.phase === 'countdown') {
      this.announce(events);
      this.countdownLeft -= dt;
      this.announce(events);
      if (this.countdownLeft <= EPS) {
        events.push({ kind: 'go' });
        this.phase = 'racing';
        this.time = 0;
      }
      return events;
    }
    if (this.phase !== 'racing') return events;

    this.time += dt;
    const finishers: Kart[] = [];
    for (const k of karts) {
      if (k.finishedAt !== null) continue;
      updateProgress(k, track);
      const lap = lapOf(k, track);
      const announced = this.announcedLap.get(k.id) ?? 1;
      for (let l = announced + 1; l <= lap; l++) {
        events.push({ kind: 'lap', kartId: k.id, lap: l });
        if (l === TOTAL_LAPS) events.push({ kind: 'finalLap', kartId: k.id });
      }
      if (lap > announced) this.announcedLap.set(k.id, lap);
      if (isFinished(k, track)) finishers.push(k);
    }
    // Karts crossing the line in the same step are placed by how far past it they are.
    finishers.sort((a, b) => b.distance - a.distance);
    for (const k of finishers) {
      k.finishedAt = this.time;
      events.push({ kind: 'finish', kartId: k.id, place: ++this.finishCount });
      if (this.firstHumanFinishedAt === null && isHuman(k.id)) this.firstHumanFinishedAt = this.time;
    }

    if (this.raceIsOver(karts, isHuman)) {
      this.phase = 'results';
      events.push({ kind: 'results' });
    }
    return events;
  }

  /** Emits every countdown number whose moment has been reached, in order. */
  private announce(events: RaceEvent[]): void {
    for (;;) {
      const n = this.nextCount;
      if (n === 0 || this.countdownLeft > n + EPS) return;
      events.push({ kind: 'countdown', n });
      this.nextCount = (n - 1) as 2 | 1 | 0;
    }
  }

  private raceIsOver(karts: Kart[], isHuman: (kartId: number) => boolean): boolean {
    const humans = karts.filter((k) => isHuman(k.id));
    if (humans.length === 0) return karts.every((k) => k.finishedAt !== null);
    if (humans.every((k) => k.finishedAt !== null)) return true;
    return this.firstHumanFinishedAt !== null && this.time - this.firstHumanFinishedAt >= FINISH_GRACE - EPS;
  }
}
