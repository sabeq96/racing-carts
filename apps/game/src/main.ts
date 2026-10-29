import { Engine } from '@babylonjs/core/Engines/engine';
import { MAX_PLAYERS, NEUTRAL_INPUT } from '@rc/shared';
import { runProbe } from './probe';
import { Game, type Driver } from './game';
import { FixedStepper } from './loop';
import { createKeyboard } from './input/keyboard';
import { buildTrack } from './track/track';
import { TRACK_V1 } from './track/trackDef';
import { compareRank, lapOf } from './race/progress';
import type { Kart } from './kart/kart';
import type { Vec2 } from './math/vec2';
import { createScene } from './render/scene';
import { KartViews } from './render/kartViews';
import { CameraRig } from './render/camera';
import { Hud, type RaceRow } from './render/hud';

const hudRoot = document.getElementById('hud');
if (!hudRoot) throw new Error('missing #hud');

const params = new URLSearchParams(location.search);

/** Bot names follow the slot colours. */
const BOT_NAMES = ['Coral', 'Sky', 'Mint', 'Butter', 'Lavender', 'Peach'];

function runGame(root: HTMLElement): void {
  const hud = new Hud(root);
  const canvas = document.getElementById('c') as HTMLCanvasElement;

  // Keyboard is on by default for desktop dev; `?keyboard=0` turns it off.
  const keyboardOn = params.get('keyboard') !== '0';
  const humans = keyboardOn ? 1 : 0;
  const botsParam = Number.parseInt(params.get('bots') ?? '', 10);
  const bots = Number.isFinite(botsParam)
    ? Math.max(0, Math.min(MAX_PLAYERS - humans, botsParam))
    : MAX_PLAYERS - humans;
  const slotCount = humans + bots;
  // Antialiasing is on unless `?aa=0` (an escape hatch if the TV GPU struggles).
  const antialias = params.get('aa') !== '0';

  let engine: Engine;
  try {
    engine = new Engine(canvas, antialias, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, false);
  } catch {
    hud.message("This screen can't draw 3D");
    return;
  }

  const track = buildTrack(TRACK_V1);
  const game = new Game(track);
  game.setupKarts(slotCount);

  const scene = createScene(engine, track);
  const views = new KartViews(scene);
  const rig = new CameraRig(scene, track.bounds);
  const stepper = new FixedStepper(60);

  const keyboard = keyboardOn ? createKeyboard() : null;
  const keyboardDriver: Driver | null = keyboard ? { kind: 'human', name: 'Keyboard', input: () => keyboard.input() } : null;
  const botDrivers = BOT_NAMES.map((name): Driver => ({ kind: 'bot', name, input: () => NEUTRAL_INPUT }));
  // Kart 0 is the keyboard; the rest idle until bots arrive in Task 10.
  const drivers = (id: number): Driver => (id === 0 && keyboardDriver) || botDrivers[id];

  // Reused every frame so the render loop does not allocate.
  const ranked: Kart[] = [];
  const rows: RaceRow[] = [];
  const framed: Vec2[] = [];
  const rowsFor = (): RaceRow[] => {
    ranked.length = 0;
    for (const k of game.karts) ranked.push(k);
    ranked.sort(compareRank);
    rows.length = ranked.length;
    for (let i = 0; i < ranked.length; i++) {
      const k = ranked[i];
      const row = rows[i] || (rows[i] = { name: '', color: '', lap: 1, item: null });
      row.name = drivers(k.id).name;
      row.color = k.color;
      row.lap = lapOf(k, track);
      row.item = k.item;
    }
    return rows;
  };

  if (keyboard) {
    hud.message('Press Enter to start');
    keyboard.onEnter(() => {
      const phase = game.race.phase;
      if (phase === 'results') game.setupKarts(slotCount);
      if (phase === 'lobby' || phase === 'results') {
        game.race.start();
        hud.message(null);
      }
    });
  }

  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime() / 1000;
    stepper.advance(dt, (h) => {
      for (const e of game.step(h, drivers)) {
        if (e.kind === 'countdown') hud.countdown(e.n);
        else if (e.kind === 'go') hud.countdown('GO');
        else if (e.kind === 'results') {
          hud.results(rowsFor(), keyboard ? 'Press Enter to race again' : '');
        }
      }
    });
    const phase = game.race.phase;
    if (phase === 'countdown' || phase === 'racing') hud.race(rowsFor());

    views.update(game.karts);
    const humanIds = game.humanKartIds();
    framed.length = 0;
    for (const k of game.karts) if (humanIds.length === 0 || humanIds.indexOf(k.id) >= 0) framed.push(k.pos);
    rig.update(framed, engine.getAspectRatio(rig.camera), Math.min(0.1, dt));
    scene.render();
  });
  window.addEventListener('resize', () => engine.resize());
}

if (params.get('probe') === '1') {
  runProbe(hudRoot);
} else {
  runGame(hudRoot);
}
