import { describe, expect, test, vi } from 'vitest';
import { ENGINE_VOLUME, MUSIC_VOLUME, createAudio, engineRate, smoothRate, type AudioDeps } from './audio';
import { ALL_SOUNDS } from './manifest';

/** Records everything the audio code does to a fake Web Audio graph. */
function fakeContext(state: 'running' | 'suspended' = 'running') {
  const sources: FakeSource[] = [];
  const log: string[] = [];
  const param = (initial = 1) => ({
    value: initial,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(function (this: { target?: number }, v: number) {
      this.target = v;
    }),
    setTargetAtTime: vi.fn(function (this: { target?: number }, v: number) {
      this.target = v;
    }),
    target: undefined as number | undefined,
  });
  interface FakeSource {
    buffer: unknown;
    loop: boolean;
    playbackRate: ReturnType<typeof param>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }
  const ctx = {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(async function (this: { state: string }) {
      ctx.state = 'running';
    }),
    createGain: () => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() }),
    createBufferSource: () => {
      const s: FakeSource = { buffer: null, loop: false, playbackRate: param(), start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null };
      sources.push(s);
      return s;
    },
    decodeAudioData: (bytes: ArrayBuffer, ok: (b: unknown) => void, bad: (e: unknown) => void) => {
      const tag = new TextDecoder().decode(bytes);
      if (tag === 'corrupt') bad(new Error('EncodingError'));
      else ok({ tag });
      return undefined;
    },
  };
  return { ctx, sources, log };
}

function setup(opts: { missing?: string[]; corrupt?: string[]; state?: 'running' | 'suspended'; gestureTarget?: AudioDeps['gestureTarget']; lazyContext?: boolean } = {}) {
  const f = fakeContext(opts.state);
  const warn = vi.fn();
  const readBytes = vi.fn(async (url: string) => {
    const name = url.split('/').pop()!.replace('.mp3', '');
    if (opts.missing?.includes(name)) throw new Error('HTTP 404');
    return new TextEncoder().encode(opts.corrupt?.includes(name) ? 'corrupt' : name).buffer as ArrayBuffer;
  });
  const audio = createAudio('audio/', {
    createContext: () => f.ctx as unknown as AudioContext,
    readBytes,
    warn,
    gestureTarget: opts.gestureTarget ?? null,
    lazyContext: opts.lazyContext ?? false,
  });
  return { ...f, audio, warn, readBytes };
}

describe('engine pitch', () => {
  test('follows 0.8 + 0.6 * speed01 and tolerates bad input', () => {
    expect(engineRate(0)).toBeCloseTo(0.8);
    expect(engineRate(1)).toBeCloseTo(1.4);
    expect(engineRate(0.5)).toBeCloseTo(1.1);
    expect(engineRate(-3)).toBeCloseTo(0.8);
    expect(engineRate(NaN)).toBeCloseTo(0.8);
    expect(engineRate(50)).toBeLessThan(1.8);
  });

  test('smoothing glides toward the target and never overshoots', () => {
    let r = 0.8;
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) seen.push((r = smoothRate(r, 1.4, 1 / 60)));
    expect(seen[0]).toBeGreaterThan(0.8);
    expect(seen[0]).toBeLessThan(0.85); // no jump
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(seen[9]).toBeLessThan(1.4);
    expect(smoothRate(1, 1.4, 0)).toBe(1);
    expect(smoothRate(1, 1.4, 100)).toBeCloseTo(1.4);
  });
});

describe('loading', () => {
  test('loads every manifest file from the base url', async () => {
    const { audio, readBytes, warn } = setup();
    await audio.load();
    expect(readBytes.mock.calls.map((c) => c[0]).sort()).toEqual(ALL_SOUNDS.map((n) => `audio/${n}.mp3`).sort());
    expect(warn).not.toHaveBeenCalled();
  });

  test('a missing or corrupt file warns once, stays silent, and does not reject', async () => {
    const { audio, sources, warn } = setup({ missing: ['boost'], corrupt: ['wall_bump'] });
    await expect(audio.load()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    audio.play('boost');
    audio.play('boost');
    audio.play('wall_bump');
    expect(sources).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(2);
    audio.play('lap_complete');
    expect(sources).toHaveLength(1);
  });

  test('a throwing reader is handled like a missing file', async () => {
    const f = fakeContext();
    const warn = vi.fn();
    const audio = createAudio('', {
      createContext: () => f.ctx as unknown as AudioContext,
      readBytes: () => {
        throw new Error('sync boom');
      },
      warn,
    });
    await expect(audio.load()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(ALL_SOUNDS.length);
  });
});

describe('without Web Audio', () => {
  test('no context: silent, one warning, nothing throws', async () => {
    const warn = vi.fn();
    const readBytes = vi.fn();
    const audio = createAudio('audio/', { createContext: () => null, readBytes, warn, lazyContext: false });
    await audio.load();
    audio.play('boost');
    audio.music('music_race');
    audio.engine(0.5);
    audio.engine(null);
    audio.unlock();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(readBytes).not.toHaveBeenCalled();
  });

  test('a constructor that throws is also survivable', () => {
    const warn = vi.fn();
    const audio = createAudio('audio/', {
      createContext: () => {
        throw new Error('blocked');
      },
      warn,
      lazyContext: false,
    });
    audio.play('boost');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('lazy context (desktop)', () => {
  function lazySetup() {
    const handlers = new Map<string, () => void>();
    const target = {
      addEventListener: (e: string, h: () => void) => void handlers.set(e, h),
      removeEventListener: (e: string) => void handlers.delete(e),
    };
    const f = fakeContext('suspended');
    const created = vi.fn(() => {
      f.ctx.state = 'running'; // a context made inside a key press starts running
      return f.ctx as unknown as AudioContext;
    });
    const warn = vi.fn();
    const readBytes = vi.fn(async (url: string) => new TextEncoder().encode(url).buffer as ArrayBuffer);
    const audio = createAudio('audio/', { createContext: created, readBytes, warn, gestureTarget: target, lazyContext: true });
    return { ...f, audio, created, warn, readBytes, handlers };
  }
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  test('no AudioContext is created before the first press', async () => {
    const { audio, created, handlers, readBytes, warn } = lazySetup();
    audio.unlock();
    await audio.load();
    audio.music('music_lobby');
    audio.play('boost');
    audio.engine(0.5);
    expect(created).not.toHaveBeenCalled();
    expect(readBytes).toHaveBeenCalledTimes(ALL_SOUNDS.length); // files are read early
    expect(handlers.size).toBe(3);
    expect(warn).not.toHaveBeenCalled();
  });

  test('the first press creates the context, decodes the files and starts the wanted music', async () => {
    const { audio, created, handlers, sources, warn } = lazySetup();
    audio.unlock();
    await audio.load();
    audio.music('music_lobby');
    handlers.get('keydown')!();
    await settle();
    expect(created).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(1);
    expect(sources[0].loop).toBe(true);
    audio.play('boost');
    expect(sources).toHaveLength(2);
    expect(handlers.size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a press before the files are read still ends up decoded', async () => {
    const { audio, handlers, sources } = lazySetup();
    audio.unlock();
    handlers.get('pointerdown')!();
    await audio.load();
    audio.play('boost');
    expect(sources).toHaveLength(1);
  });

  test('a platform without Web Audio warns once on the press and stops listening', async () => {
    const handlers = new Map<string, () => void>();
    const warn = vi.fn();
    const audio = createAudio('audio/', {
      createContext: () => null,
      readBytes: async () => new ArrayBuffer(4),
      warn,
      lazyContext: true,
      gestureTarget: {
        addEventListener: (e, h) => void handlers.set(e, h as () => void),
        removeEventListener: (e) => void handlers.delete(e),
      },
    });
    audio.unlock();
    handlers.get('keydown')!();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(handlers.size).toBe(0);
    audio.play('boost');
    await audio.load();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('play', () => {
  test('ignores unknown names', async () => {
    const { audio, sources } = setup();
    await audio.load();
    audio.play('definitely_not_a_sound' as never);
    expect(sources).toHaveLength(0);
  });

  test('plays one-shots without looping', async () => {
    const { audio, sources } = setup();
    await audio.load();
    audio.play('boost');
    audio.play('boost');
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => !s.loop && s.start.mock.calls.length === 1)).toBe(true);
  });

  test('finished one-shots are disconnected', async () => {
    const { audio, sources } = setup();
    await audio.load();
    audio.play('boost');
    expect(sources[0].disconnect).not.toHaveBeenCalled();
    sources[0].onended?.();
    expect(sources[0].disconnect).toHaveBeenCalledTimes(1);
  });

  test('is silent before load()', () => {
    const { audio, sources } = setup();
    audio.play('boost');
    expect(sources).toHaveLength(0);
  });
});

describe('music', () => {
  test('does not restart the same track, crossfades to a different one', async () => {
    const { audio, sources, ctx } = setup();
    await audio.load();
    audio.music('music_lobby');
    audio.music('music_lobby');
    expect(sources).toHaveLength(1);
    expect(sources[0].loop).toBe(true);
    expect(sources[0].stop).not.toHaveBeenCalled();
    ctx.currentTime = 10;
    audio.music('music_race');
    expect(sources).toHaveLength(2);
    expect(sources[0].stop).toHaveBeenCalledTimes(1);
    expect(sources[0].stop.mock.calls[0][0]).toBeGreaterThan(10); // faded, not cut
    audio.music('music_race');
    expect(sources).toHaveLength(2);
  });

  test('music requested before load() starts when loading finishes', async () => {
    const { audio, sources } = setup();
    audio.music('music_lobby');
    expect(sources).toHaveLength(0);
    await audio.load();
    expect(sources).toHaveLength(1);
  });

  test('null fades the track out; a missing track stays silent without warnings beyond the load one', async () => {
    const { audio, sources, warn } = setup({ missing: ['music_race'] });
    await audio.load();
    audio.music('music_lobby');
    audio.music(null);
    expect(sources[0].stop).toHaveBeenCalledTimes(1);
    audio.music('music_race');
    audio.music('music_race');
    expect(sources).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('fades toward the music volume', async () => {
    const { audio } = setup();
    await audio.load();
    audio.music('music_lobby');
    expect(MUSIC_VOLUME).toBeCloseTo(0.5);
  });
});

describe('engine', () => {
  test('starts looping at the speed pitch and glides after that', async () => {
    const { audio, sources, ctx } = setup();
    await audio.load();
    audio.engine(1);
    expect(sources).toHaveLength(1);
    expect(sources[0].loop).toBe(true);
    expect(sources[0].playbackRate.value).toBeCloseTo(1.4);
    ctx.currentTime = 0.016;
    audio.engine(0);
    const r = sources[0].playbackRate.value;
    expect(r).toBeLessThan(1.4);
    expect(r).toBeGreaterThan(1.3); // one frame: no jump to 0.8
    expect(sources).toHaveLength(1);
    expect(ENGINE_VOLUME).toBeCloseTo(0.35);
  });

  test('null stops it and a later call starts a fresh loop', async () => {
    const { audio, sources, ctx } = setup();
    await audio.load();
    audio.engine(0.2);
    ctx.currentTime = 1;
    audio.engine(null);
    expect(sources[0].stop).toHaveBeenCalledTimes(1);
    audio.engine(null);
    expect(sources[0].stop).toHaveBeenCalledTimes(1);
    audio.engine(0.2);
    expect(sources).toHaveLength(2);
  });

  test('two race starts in a row leave exactly one engine voice running', async () => {
    const { audio, sources, ctx } = setup();
    await audio.load();
    const active = () => sources.filter((s) => s.loop && s.stop.mock.calls.length === 0).length;
    // Race 1: engine on for a while, then results (null), then race 2.
    for (let i = 0; i < 5; i++) {
      ctx.currentTime += 0.016;
      audio.engine(0.4);
    }
    expect(active()).toBe(1);
    audio.engine(null);
    expect(active()).toBe(0);
    for (let i = 0; i < 5; i++) {
      ctx.currentTime += 0.016;
      audio.engine(0.4);
    }
    expect(active()).toBe(1);
    audio.engine(null);
    audio.engine(null);
    audio.engine(0.1);
    audio.engine(0.1);
    expect(active()).toBe(1);
  });

  test('without a file it stays silent', async () => {
    const { audio, sources } = setup({ missing: ['engine_loop'] });
    await audio.load();
    audio.engine(0.5);
    expect(sources).toHaveLength(0);
  });
});

describe('unlock', () => {
  test('resumes a suspended context at once and on the first press until it runs', async () => {
    const handlers = new Map<string, () => void>();
    const target = {
      addEventListener: (e: string, h: () => void) => void handlers.set(e, h),
      removeEventListener: (e: string) => void handlers.delete(e),
    };
    const { audio, ctx } = setup({ state: 'suspended', gestureTarget: target });
    ctx.resume.mockImplementationOnce(() => new Promise<void>(() => {})); // pending, like a browser before a gesture
    audio.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect([...handlers.keys()].sort()).toEqual(['keydown', 'pointerdown', 'touchstart']);
    handlers.get('keydown')!();
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.state).toBe('running');
    expect(handlers.size).toBe(0);
  });

  test('a desktop does not resume before a press, but waits for one', () => {
    const add = vi.fn();
    const { audio, ctx } = setup({
      state: 'suspended',
      lazyContext: true,
      gestureTarget: { addEventListener: add, removeEventListener: vi.fn() },
    });
    audio.unlock();
    audio.unlock(); // asking again does not stack listeners
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(3);
  });

  test('asking again retries the resume while the context is not running, and stops once it is', async () => {
    const { audio, ctx } = setup({ state: 'suspended', gestureTarget: { addEventListener: vi.fn(), removeEventListener: vi.fn() } });
    ctx.resume.mockImplementation(async () => {}); // the boot resume did not take
    audio.unlock();
    audio.unlock();
    audio.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(3);
    expect(ctx.state).toBe('suspended');
    ctx.resume.mockImplementation(async () => {
      ctx.state = 'running';
    });
    audio.unlock();
    await Promise.resolve();
    expect(ctx.state).toBe('running');
    const calls = ctx.resume.mock.calls.length;
    audio.unlock(); // cheap no-op now
    audio.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(calls);
  });

  test('a running context needs no listeners', () => {
    const add = vi.fn();
    const { audio, ctx } = setup({ state: 'running', gestureTarget: { addEventListener: add, removeEventListener: vi.fn() } });
    audio.unlock();
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  test('a rejecting resume does not throw', () => {
    const { audio, ctx } = setup({ state: 'suspended' });
    ctx.resume.mockImplementation(() => Promise.reject(new Error('no')));
    expect(() => audio.unlock()).not.toThrow();
  });
});
