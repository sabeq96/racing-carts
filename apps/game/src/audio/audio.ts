import { ALL_SOUNDS, MUSIC, type MusicName, type SoundName } from './manifest';

/** Linear gains (1 = the file as recorded). The files are normalised, so these set the mix. */
export const MUSIC_VOLUME = 0.5;
export const SFX_VOLUME = 1.0;
export const ENGINE_VOLUME = 0.35;

/** Seconds to crossfade between the two music tracks. */
const MUSIC_FADE = 0.8;
/** Time constants (s): how fast the engine fades in/out and how fast its pitch follows the speed. */
const ENGINE_FADE_TC = 0.1;
const ENGINE_RATE_TC = 0.2;
const ENGINE_STOP_DELAY = 0.6;
/** Engine pitch for `speed01` = average kart speed / MAX_SPEED (boosts may push it above 1). */
const ENGINE_RATE_MIN = 0.8;
const ENGINE_RATE_SPAN = 0.6;
const ENGINE_SPEED_MAX = 1.5;

/** `playbackRate = 0.8 + 0.6 * speed01`, with `speed01` kept to 0..1.5. */
export function engineRate(speed01: number): number {
  const s = Number.isFinite(speed01) ? Math.max(0, Math.min(ENGINE_SPEED_MAX, speed01)) : 0;
  return ENGINE_RATE_MIN + ENGINE_RATE_SPAN * s;
}

/** Moves `current` toward `target` like a one-pole filter, so the pitch glides instead of jumping. */
export function smoothRate(current: number, target: number, dt: number): number {
  if (!(dt > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-dt / ENGINE_RATE_TC));
}

export interface Audio {
  /** Fetches and decodes every file. Never rejects: a bad file only silences that sound. */
  load(): Promise<void>;
  /** Plays a one-shot. Unknown names and sounds that failed to load are ignored. */
  play(name: SoundName): void;
  /** Crossfades to this track (null fades out). Asking for the track already playing does nothing. */
  music(name: MusicName | null): void;
  /** Engine loop pitched by `speed01` (average kart speed / MAX_SPEED); null stops it. */
  engine(speed01: number | null): void;
  /** Resumes the AudioContext now and on the first key or pointer press (browsers block sound before one). */
  unlock(): void;
}

/** Test seams; the defaults use the browser. */
export interface AudioDeps {
  /** The Web Audio context, or null when the platform has none. Called once. */
  createContext?: () => AudioContext | null;
  /** Reads a file as bytes (rejects on any failure). */
  readBytes?: (url: string) => Promise<ArrayBuffer>;
  warn?: (message: string) => void;
  /** Where the first key / pointer press is heard (default `window`). */
  gestureTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  /** Try to resume at boot, before any key press (default: only on a TV, see `isTv`). */
  resumeAtBoot?: boolean;
}

/** True on a smart-TV browser (Tizen, webOS), where there is no mouse or keyboard to unlock sound and autoplay is allowed. */
function isTv(): boolean {
  return typeof navigator !== 'undefined' && /Tizen|SMART-TV|Web0S/i.test(navigator.userAgent);
}

function defaultContext(): AudioContext | null {
  const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/**
 * XMLHttpRequest rather than fetch: in a packaged TV app the page is served from file://, where Chromium's
 * fetch refuses the request but XHR (responseType 'arraybuffer') works. XHR also works over http.
 */
function xhrBytes(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      // file:// reports status 0 on success.
      const ok = (xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.response);
      if (ok && xhr.response instanceof ArrayBuffer && xhr.response.byteLength > 0) resolve(xhr.response);
      else reject(new Error(`HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('request failed'));
    xhr.send();
  });
}

interface Voice {
  name: MusicName;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Web Audio mixer: one-shots, two crossfading music tracks and a pitch-shifted engine loop.
 * Audio never breaks the game: every failure is caught, logged once per file, and leaves that sound silent.
 */
export function createAudio(baseUrl: string, deps: AudioDeps = {}): Audio {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const readBytes = deps.readBytes ?? xhrBytes;
  const base = baseUrl.endsWith('/') || baseUrl === '' ? baseUrl : baseUrl + '/';

  let ctx: AudioContext | null = null;
  let failed = false;
  try {
    ctx = (deps.createContext ?? defaultContext)();
  } catch (err) {
    ctx = null;
    failed = true;
    warn(`Audio unavailable, the game stays silent: ${describe(err)}`);
  }
  if (!ctx) {
    if (!failed) warn('Audio unavailable, the game stays silent: no AudioContext');
    return { load: () => Promise.resolve(), play() {}, music() {}, engine() {}, unlock() {} };
  }
  const audio: AudioContext = ctx;

  const buffers = new Map<string, AudioBuffer>();
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(message);
  };

  let sfxBus: GainNode | null = null;
  const sfxOut = (): AudioNode => {
    if (!sfxBus) {
      sfxBus = audio.createGain();
      sfxBus.gain.value = SFX_VOLUME;
      sfxBus.connect(audio.destination);
    }
    return sfxBus;
  };

  /** Ramps `param` to `value` over `seconds` from wherever it is now. */
  const ramp = (param: AudioParam, value: number, seconds: number): void => {
    const t = audio.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + seconds);
  };

  // ----- loading -----
  const loadOne = async (name: SoundName): Promise<void> => {
    const url = `${base}${name}.mp3`;
    try {
      const bytes = await readBytes(url);
      const buf = await new Promise<AudioBuffer>((resolve, reject) => {
        // Callback form for old engines; the promise it also returns must not go unhandled.
        const p = audio.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
        if (p && typeof p.catch === 'function') p.catch(() => {});
      });
      buffers.set(name, buf);
    } catch (err) {
      warnOnce(name, `Audio: could not load ${url} (${describe(err)}); that sound stays silent`);
    }
  };

  // ----- music -----
  let wantedMusic: MusicName | null = null;
  let currentMusic: Voice | null = null;

  const fadeOutVoice = (v: Voice): void => {
    try {
      ramp(v.gain.gain, 0, MUSIC_FADE);
      v.src.stop(audio.currentTime + MUSIC_FADE + 0.05);
    } catch {
      /* already stopped */
    }
  };

  const applyMusic = (): void => {
    if ((currentMusic?.name ?? null) === wantedMusic) return;
    if (currentMusic) fadeOutVoice(currentMusic);
    currentMusic = null;
    if (wantedMusic === null) return;
    const buf = buffers.get(wantedMusic);
    if (!buf) return; // not loaded (yet): load() calls applyMusic again
    const src = audio.createBufferSource();
    const gain = audio.createGain();
    src.buffer = buf;
    src.loop = true;
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(audio.destination);
    src.start();
    ramp(gain.gain, MUSIC_VOLUME, MUSIC_FADE);
    currentMusic = { name: wantedMusic, src, gain };
  };

  // ----- engine -----
  let engineVoice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  let engineRateNow = engineRate(0);
  let engineClock = 0;

  const stopEngine = (): void => {
    const v = engineVoice;
    if (!v) return;
    engineVoice = null;
    try {
      v.gain.gain.cancelScheduledValues(audio.currentTime);
      v.gain.gain.setTargetAtTime(0, audio.currentTime, ENGINE_FADE_TC);
      v.src.stop(audio.currentTime + ENGINE_STOP_DELAY);
    } catch {
      /* already stopped */
    }
  };

  const run = (what: string, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      warnOnce(`run:${what}`, `Audio: ${what} failed (${describe(err)})`);
    }
  };

  // ----- unlock -----
  let unlocking = false;
  /** Tries to resume the context; resolves true once it is running. Never rejects. */
  const resume = (): Promise<boolean> => {
    if (audio.state === 'running') return Promise.resolve(true);
    try {
      return Promise.resolve(audio.resume()).then(
        () => audio.state === 'running',
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  };

  return {
    load: async () => {
      await Promise.all(ALL_SOUNDS.map(loadOne));
      run('music', applyMusic);
    },

    play(name) {
      const buf = buffers.get(name);
      if (!buf) return; // unknown name, or the file failed to load
      run('play', () => {
        const src = audio.createBufferSource();
        src.buffer = buf;
        src.connect(sfxOut());
        src.start();
      });
    },

    music(name) {
      if (name !== null && !(MUSIC as readonly string[]).includes(name)) return;
      wantedMusic = name;
      run('music', applyMusic);
    },

    engine(speed01) {
      run('engine', () => {
        if (speed01 === null) {
          stopEngine();
          return;
        }
        const target = engineRate(speed01);
        const now = audio.currentTime;
        if (!engineVoice) {
          const buf = buffers.get('engine_loop');
          if (!buf) return;
          const src = audio.createBufferSource();
          const gain = audio.createGain();
          src.buffer = buf;
          src.loop = true;
          gain.gain.value = 0;
          src.playbackRate.value = engineRateNow = target;
          src.connect(gain);
          gain.connect(audio.destination);
          src.start();
          gain.gain.setTargetAtTime(ENGINE_VOLUME, now, ENGINE_FADE_TC);
          engineVoice = { src, gain };
        } else {
          engineRateNow = smoothRate(engineRateNow, target, now - engineClock);
          engineVoice.src.playbackRate.value = engineRateNow;
        }
        engineClock = now;
      });
    },

    unlock() {
      // On the TV this alone works. A desktop browser would only log an autoplay warning, so it waits for a press.
      if (deps.resumeAtBoot ?? isTv()) void resume();
      if (unlocking || audio.state === 'running') return;
      const target = deps.gestureTarget === undefined ? (typeof window === 'undefined' ? null : window) : deps.gestureTarget;
      if (!target) return;
      unlocking = true;
      const events = ['keydown', 'pointerdown', 'touchstart'];
      // Stay subscribed until a press actually gets the context running.
      const onGesture = (): void => {
        void resume().then((ok) => {
          if (ok) for (const e of events) target.removeEventListener(e, onGesture);
        });
      };
      for (const e of events) target.addEventListener(e, onGesture);
    },
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
