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
  /**
   * Create the AudioContext on the first key / pointer press instead of at boot (default: everywhere except a TV,
   * see `isTv`). A desktop browser logs an autoplay warning for a context created before a press; a TV has no
   * keyboard or mouse, so it creates the context at once and keeps trying to resume it.
   */
  lazyContext?: boolean;
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
 *
 * On a desktop the context is created by the first key / pointer press; `load()` reads the raw files early and
 * decodes them as soon as the context exists. Until then every call is a quiet no-op.
 */
export function createAudio(baseUrl: string, deps: AudioDeps = {}): Audio {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const readBytes = deps.readBytes ?? xhrBytes;
  const base = baseUrl.endsWith('/') || baseUrl === '' ? baseUrl : baseUrl + '/';
  const lazy = deps.lazyContext ?? !isTv();

  /** The Web Audio context: null until created, and for good when the platform has none. */
  let ac: AudioContext | null = null;
  let unavailable = false;
  /** Files read but not yet decoded (decoding needs the context). */
  const raw = new Map<SoundName, ArrayBuffer>();
  const buffers = new Map<string, AudioBuffer>();
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    warn(message);
  };
  const run = (what: string, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      warnOnce(`run:${what}`, `Audio: ${what} failed (${describe(err)})`);
    }
  };

  let sfxBus: GainNode | null = null;
  const sfxOut = (c: AudioContext): AudioNode => {
    if (!sfxBus) {
      sfxBus = c.createGain();
      sfxBus.gain.value = SFX_VOLUME;
      sfxBus.connect(c.destination);
    }
    return sfxBus;
  };

  /** Ramps `param` to `value` over `seconds` from wherever it is now. */
  const ramp = (c: AudioContext, param: AudioParam, value: number, seconds: number): void => {
    const t = c.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + seconds);
  };

  // ----- loading -----
  const readOne = async (name: SoundName): Promise<void> => {
    const url = `${base}${name}.mp3`;
    try {
      raw.set(name, await readBytes(url));
    } catch (err) {
      warnOnce(name, `Audio: could not load ${url} (${describe(err)}); that sound stays silent`);
    }
  };

  const decodeOne = async (c: AudioContext, name: SoundName, bytes: ArrayBuffer): Promise<void> => {
    try {
      const buf = await new Promise<AudioBuffer>((resolve, reject) => {
        // Callback form for old engines; the promise it also returns must not go unhandled.
        const p = c.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
        if (p && typeof p.catch === 'function') p.catch(() => {});
      });
      buffers.set(name, buf);
    } catch (err) {
      warnOnce(name, `Audio: could not load ${base}${name}.mp3 (${describe(err)}); that sound stays silent`);
    }
  };

  /** Decodes whatever has been read so far (nothing happens before the context exists). */
  const decodeAll = async (): Promise<void> => {
    const c = ac;
    if (!c || raw.size === 0) return;
    const pending = [...raw];
    raw.clear();
    await Promise.all(pending.map(([name, bytes]) => decodeOne(c, name, bytes)));
  };

  // ----- context -----
  const ensureContext = (): AudioContext | null => {
    if (ac || unavailable) return ac;
    try {
      ac = (deps.createContext ?? defaultContext)();
      if (!ac) {
        unavailable = true;
        warn('Audio unavailable, the game stays silent: no AudioContext');
      }
    } catch (err) {
      ac = null;
      unavailable = true;
      warn(`Audio unavailable, the game stays silent: ${describe(err)}`);
    }
    if (ac) void decodeAll().then(() => run('music', applyMusic));
    return ac;
  };

  // ----- music -----
  let wantedMusic: MusicName | null = null;
  let currentMusic: Voice | null = null;

  const fadeOutVoice = (c: AudioContext, v: Voice): void => {
    try {
      ramp(c, v.gain.gain, 0, MUSIC_FADE);
      v.src.stop(c.currentTime + MUSIC_FADE + 0.05);
      v.src.onended = () => {
        v.src.disconnect();
        v.gain.disconnect();
      };
    } catch {
      /* already stopped */
    }
  };

  function applyMusic(): void {
    const c = ac;
    if (!c) return; // created later: ensureContext() calls this again once the files are decoded
    if ((currentMusic?.name ?? null) === wantedMusic) return;
    if (currentMusic) fadeOutVoice(c, currentMusic);
    currentMusic = null;
    if (wantedMusic === null) return;
    const buf = buffers.get(wantedMusic);
    if (!buf) return; // not loaded (yet): load() calls applyMusic again
    const src = c.createBufferSource();
    const gain = c.createGain();
    src.buffer = buf;
    src.loop = true;
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(c.destination);
    src.start();
    ramp(c, gain.gain, MUSIC_VOLUME, MUSIC_FADE);
    currentMusic = { name: wantedMusic, src, gain };
  }

  // ----- engine -----
  let engineVoice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  let engineRateNow = engineRate(0);
  let engineClock = 0;

  const stopEngine = (c: AudioContext): void => {
    const v = engineVoice;
    if (!v) return;
    engineVoice = null;
    try {
      v.gain.gain.cancelScheduledValues(c.currentTime);
      v.gain.gain.setTargetAtTime(0, c.currentTime, ENGINE_FADE_TC);
      v.src.stop(c.currentTime + ENGINE_STOP_DELAY);
      v.src.onended = () => {
        v.src.disconnect();
        v.gain.disconnect();
      };
    } catch {
      /* already stopped */
    }
  };

  // ----- unlock -----
  let unlocking = false;
  /** Tries to resume the context; resolves true once it is running. Never rejects. */
  const resume = (): Promise<boolean> => {
    const c = ac;
    if (!c) return Promise.resolve(false);
    if (c.state === 'running') return Promise.resolve(true);
    try {
      return Promise.resolve(c.resume()).then(
        () => c.state === 'running',
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  };

  const audio: Audio = {
    load: async () => {
      if (unavailable) return;
      await Promise.all(ALL_SOUNDS.map(readOne));
      await decodeAll();
      run('music', applyMusic);
    },

    play(name) {
      const c = ac;
      const buf = buffers.get(name);
      if (!c || !buf) return; // no context yet, an unknown name, or the file failed to load
      run('play', () => {
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(sfxOut(c));
        src.onended = () => src.disconnect(); // let the node graph forget finished one-shots
        src.start();
      });
    },

    music(name) {
      if (name !== null && !(MUSIC as readonly string[]).includes(name)) return;
      wantedMusic = name;
      run('music', applyMusic);
    },

    engine(speed01) {
      const c = ac;
      if (!c) return;
      run('engine', () => {
        if (speed01 === null) {
          stopEngine(c);
          return;
        }
        const target = engineRate(speed01);
        const now = c.currentTime;
        if (!engineVoice) {
          const buf = buffers.get('engine_loop');
          if (!buf) return;
          const src = c.createBufferSource();
          const gain = c.createGain();
          src.buffer = buf;
          src.loop = true;
          gain.gain.value = 0;
          src.playbackRate.value = engineRateNow = target;
          src.connect(gain);
          gain.connect(c.destination);
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

    /**
     * Cheap and idempotent, so the game can call it again whenever sound is not running yet (on each phase
     * change and player join). On a TV it retries `resume()` every time; everywhere it waits for a key or
     * pointer press, which on a desktop is also what creates the context.
     */
    unlock() {
      if (ac?.state === 'running') return;
      if (!lazy) {
        ensureContext();
        void resume();
      }
      if (unlocking) return;
      const target = deps.gestureTarget === undefined ? (typeof window === 'undefined' ? null : window) : deps.gestureTarget;
      if (!target) return;
      unlocking = true;
      const events = ['keydown', 'pointerdown', 'touchstart'];
      const stopListening = (): void => {
        for (const e of events) target.removeEventListener(e, onGesture);
        unlocking = false;
      };
      // Stay subscribed until a press actually gets the context running.
      const onGesture = (): void => {
        ensureContext();
        if (unavailable) return stopListening();
        void resume().then((ok) => {
          if (ok) stopListening();
        });
      };
      for (const e of events) target.addEventListener(e, onGesture);
    },
  };

  if (!lazy) ensureContext();
  return audio;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
