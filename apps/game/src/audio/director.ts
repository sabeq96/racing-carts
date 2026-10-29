import { TOTAL_LAPS, type Phase } from '@rc/shared';
import { MAX_SPEED } from '../kart/tuning';
import type { RaceEvent } from '../race/race';
import type { Audio } from './audio';
import type { MusicName, SoundName } from './manifest';
import { Throttle } from './throttle';

/** Minimum gap between two bump sounds for the same kart. */
const BUMP_THROTTLE_MS = 300;

/** The parts of `Game` the director reads (a structural type, so tests can pass a stub). */
export interface DirectorSource {
  drainWallHits(): readonly number[];
  drainKartBumps(): readonly number[];
  world: { drainSfx(): readonly string[] };
  race: { readonly phase: Phase };
  karts: ReadonlyArray<{ id: number; speed: number }>;
}

/** Decides which sound plays for what happens in the game. Holds no audio state itself. */
export class SoundDirector {
  private wallThrottle = new Throttle(BUMP_THROTTLE_MS);
  private bumpThrottle = new Throttle(BUMP_THROTTLE_MS);
  private lastMusic: MusicName | null = null;
  private lastPhase: Phase | null = null;

  constructor(private readonly audio: Audio) {}

  /**
   * Countdown and race events. Lap, final-lap and finish sounds are for human karts only, so six karts
   * (mostly bots) do not turn the race into constant chimes; the final lap replaces the lap chime.
   */
  raceEvent(e: RaceEvent, humanIds: readonly number[]): void {
    switch (e.kind) {
      case 'countdown':
        this.audio.play('countdown_beep');
        break;
      case 'go':
        this.audio.play('countdown_go');
        break;
      case 'lap':
        if (e.lap < TOTAL_LAPS && humanIds.indexOf(e.kartId) >= 0) this.audio.play('lap_complete');
        break;
      case 'finalLap':
        if (humanIds.indexOf(e.kartId) >= 0) this.audio.play('final_lap');
        break;
      case 'finish':
        if (humanIds.indexOf(e.kartId) >= 0) this.audio.play('race_finish');
        break;
    }
  }

  /** Once per rendered frame, after the simulation steps: drains the game's sounds, then music and engine. */
  frame(game: DirectorSource, nowMs: number): void {
    for (const id of game.drainWallHits()) {
      if (this.wallThrottle.allow(id, nowMs)) this.audio.play('wall_bump');
    }
    const bumps = game.drainKartBumps();
    // Flat list of pairs: one sound per pair, unless both karts are still inside their window.
    for (let i = 0; i + 1 < bumps.length; i += 2) {
      const a = this.bumpThrottle.allow(bumps[i], nowMs);
      const b = this.bumpThrottle.allow(bumps[i + 1], nowMs);
      if (a || b) this.audio.play('kart_bump');
    }
    for (const name of game.world.drainSfx()) this.audio.play(name as SoundName);

    const phase = game.race.phase;
    // Sound that is still locked (a TV nobody presses a key on) gets another try at every phase change.
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.audio.unlock();
    }
    const music = musicFor(phase);
    if (music !== this.lastMusic) this.audio.music((this.lastMusic = music));
    this.audio.engine(phase === 'racing' ? averageSpeed01(game.karts) : null);
  }

  playerJoined(): void {
    this.audio.unlock();
    this.audio.play('player_join');
  }
}

function musicFor(phase: Phase): MusicName {
  return phase === 'countdown' || phase === 'racing' ? 'music_race' : 'music_lobby';
}

/** Mean |speed| of all karts as a fraction of MAX_SPEED (0 with no karts). */
function averageSpeed01(karts: DirectorSource['karts']): number {
  if (karts.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < karts.length; i++) sum += Math.abs(karts[i].speed);
  return sum / karts.length / MAX_SPEED;
}
