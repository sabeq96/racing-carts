import { TOTAL_LAPS } from '@rc/shared';
import type { Kart } from '../kart/kart';
import type { Track } from '../track/track';

/** Advances `k.distance` by the wrapped change of its projected s, so reversing loses distance. */
export function updateProgress(k: Kart, track: Track): void {
  const L = track.length;
  const pr = track.project(k.pos, k.trackIndex);
  k.trackIndex = pr.index;
  const prevS = ((k.distance % L) + L) % L;
  let delta = pr.s - prevS;
  // Wrap into (-L/2, L/2].
  if (delta > L / 2) delta -= L;
  else if (delta <= -L / 2) delta += L;
  k.distance += delta;
}

export function lapOf(k: Kart, track: Track): number {
  return Math.min(TOTAL_LAPS, Math.max(1, Math.floor(k.distance / track.length) + 1));
}

export function isFinished(k: Kart, track: Track): boolean {
  return k.distance >= TOTAL_LAPS * track.length;
}

/** Race order: finished karts by finish time (ties by distance), then everyone else by distance (furthest first). */
export function compareRank(a: Kart, b: Kart): number {
  const fa = a.finishedAt !== null, fb = b.finishedAt !== null;
  if (fa && fb) return (a.finishedAt as number) - (b.finishedAt as number) || b.distance - a.distance;
  if (fa !== fb) return fa ? -1 : 1;
  return b.distance - a.distance;
}

/** Karts in race order (see `compareRank`). Returns a new array. */
export function rankKarts(karts: Kart[]): Kart[] {
  return [...karts].sort(compareRank);
}
