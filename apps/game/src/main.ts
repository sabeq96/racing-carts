import { Engine } from '@babylonjs/core/Engines/engine';
import QRCode from 'qrcode';
import { CONTROLLER_URL, MAX_PLAYERS, controllerUrl } from '@rc/shared';
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
import { EntityViews } from './render/entityViews';
import { getPowerup } from './powerups/registry';
import { CameraRig, HIT_TRAUMA } from './render/camera';
import { SparkViews } from './render/sparks';
import { Hud, type JoinMode, type RaceRow } from './render/hud';
import { startHost, type NetHost } from './net/host';
import { PlayerRegistry } from './net/players';
import { KEYBOARD_TOKEN, Session } from './session';
import { createAudio } from './audio/audio';
import { SoundDirector, type DirectorSource } from './audio/director';

const hudRoot = document.getElementById('hud');
if (!hudRoot) throw new Error('missing #hud');

const params = new URLSearchParams(location.search);

/** How often phones get their `state` (only sent when it changed) and the lobby refreshes. */
const SYNC_MS = 100;
/** Wait before trying to open the room again after a failure. */
const ROOM_RETRY_MS = 5000;
/** QR image widths in px (lobby, and the compact join card after the lobby); the library rounds down to whole pixels per module. */
const QR_WIDTH = 320;
const QR_SMALL_WIDTH = 240;
/** Shown in the TV race list while a kart's item roulette spins (the phones show the same). */
const ROLLING_ICON = '🎲';

/** Where the sound files are, relative to the page (copied from public/audio to dist/audio). */
const AUDIO_URL = 'audio/';

function runGame(root: HTMLElement): void {
  const hud = new Hud(root);
  const canvas = document.getElementById('c') as HTMLCanvasElement;

  // `?keyboard=1` adds the desktop keyboard as a player (off by default: on the TV it would always be host).
  const keyboardOn = params.get('keyboard') === '1';
  // `?bots=N` limits the bots added on top of the humans; by default they fill every free slot.
  const botsParam = Number.parseInt(params.get('bots') ?? '', 10);
  const maxBots = Number.isFinite(botsParam) ? Math.max(0, Math.min(MAX_PLAYERS, botsParam)) : MAX_PLAYERS;
  // Antialiasing: off by default on the TV (its GPU is weak, and the packaged app has no query string),
  // on elsewhere. `?aa=1` / `?aa=0` override either way.
  const onTv = /Tizen|SMART-TV/i.test(navigator.userAgent);
  const aaParam = params.get('aa');
  const antialias = aaParam === '1' ? true : aaParam === '0' ? false : !onTv;
  // DEV ONLY (screenshots): `?keyboard=1&give=<item id>` hands the keyboard kart that item at GO.
  const giveItem = keyboardOn ? params.get('give') : null;
  // DEV ONLY (screenshots): `?keyboard=1&steer=0.4` softens the all-or-nothing arrow keys to a gentle phone
  // tilt, so a keyboard drift can be held through a corner.
  const steerParam = Number.parseFloat(params.get('steer') ?? '');
  const keyboardSteer = Number.isFinite(steerParam) ? Math.max(0, Math.min(1, steerParam)) : 1;

  let engine: Engine;
  try {
    engine = new Engine(canvas, antialias, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, false);
  } catch {
    hud.message("This screen can't draw 3D");
    return;
  }

  // Sound never blocks or breaks the game: files that fail to load just stay silent.
  const audio = createAudio(AUDIO_URL);
  const sounds = new SoundDirector(audio);
  audio.unlock(); // resumes now (works on the TV), else on the first key or pointer press
  void audio.load();

  const track = buildTrack(TRACK_V1);
  const game = new Game(track);
  const registry = new PlayerRegistry();
  const keyboard = keyboardOn ? createKeyboard() : null;
  let net: NetHost | null = null;
  const session = new Session(game, registry, (token, msg) => net?.send(token, msg), {
    maxBots,
    keyboard: keyboard
      ? {
          input: () => {
            const input = keyboard.input();
            input.steer *= keyboardSteer;
            return input;
          },
        }
      : undefined,
    onJoin: () => sounds.playerJoined(),
  });
  const drivers = (id: number): Driver => session.driverFor(id);

  // ----- room: code, QR and URL once the broker answers -----
  let roomCode = '';
  let roomUrl = '';
  let qrDataUrl = '';
  let qrSmallUrl = '';
  /** Why the room is not open yet; shown in the lobby and on results, not over the racing. */
  let roomError: string | null = null;
  let shownMessage: string | null = null;
  const openRoom = (): void => {
    startHost({
      onHello: (token, name) => session.onHello(token, name),
      onMessage: (token, msg) => session.onMessage(token, msg),
      onDisconnect: (token) => session.onDisconnect(token),
    }).then(
      (h) => {
        net = h;
        roomCode = h.code;
        // The QR carries the code; the short URL on screen is for typing (the page then asks for the code).
        roomUrl = CONTROLLER_URL;
        roomError = null;
        QRCode.toDataURL(controllerUrl(h.code), { width: QR_WIDTH, margin: 1 }).then(
          (data) => {
            qrDataUrl = data;
          },
          () => {
            qrDataUrl = ''; // the code and URL still let phones join
          },
        );
        QRCode.toDataURL(controllerUrl(h.code), { width: QR_SMALL_WIDTH, margin: 1 }).then(
          (data) => {
            qrSmallUrl = data;
          },
          () => {
            qrSmallUrl = '';
          },
        );
      },
      (err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        roomError = reason === 'broker-unreachable' ? "No internet — can't create room" : "Can't create room";
        window.setTimeout(openRoom, ROOM_RETRY_MS);
      },
    );
  };
  openRoom();

  /** Who can start or rematch, in few words. */
  const hostHint = (lobby: boolean): string => {
    const host = registry.hostToken();
    if (host === null) return lobby ? 'Scan to join' : '';
    if (host === KEYBOARD_TOKEN) return lobby ? 'Press Enter to start' : 'Press Enter to race again';
    return lobby ? 'Host: tap Start on your phone' : 'Host: tap Rematch on your phone';
  };

  if (keyboard) {
    // Same host-only path as a phone's Start / Rematch button.
    keyboard.onEnter(() => {
      session.onMessage(KEYBOARD_TOKEN, { t: game.race.phase === 'results' ? 'rematch' : 'start' });
    });
  }

  const scene = createScene(engine, track);
  const views = new KartViews(scene);
  const entities = new EntityViews(scene);
  const rig = new CameraRig(scene, track.bounds);
  const sparks = new SparkViews(scene, track);
  const stepper = new FixedStepper(60);
  // Wall hits feed both the sparks and the sounds: drained once per frame, then handed to the director.
  let frameWallHits: readonly number[] = [];
  const soundSource: DirectorSource = {
    drainWallHits: () => frameWallHits,
    drainKartBumps: () => game.drainKartBumps(),
    get world() {
      return game.world;
    },
    get race() {
      return game.race;
    },
    get karts() {
      return game.karts;
    },
  };

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
      const row = rows[i] || (rows[i] = { name: '', color: '', lap: 1, item: null, finished: false });
      row.name = drivers(k.id).name;
      row.color = k.color;
      row.lap = lapOf(k, track);
      row.item = k.rolling ? ROLLING_ICON : k.item !== null ? getPowerup(k.item)?.icon ?? null : null;
      row.finished = k.finishedAt !== null;
    }
    return rows;
  };

  // The results hint names whoever is host now, so redraw it if the host changes. The rows are frozen
  // when the race ends, so a phone joining afterwards never renames a kart it did not drive.
  let resultsHint = '';
  let resultRows: { name: string; color: string }[] = [];
  const showResults = (fresh: boolean): void => {
    if (fresh) resultRows = rowsFor().map((r) => ({ name: r.name, color: r.color }));
    resultsHint = hostHint(false);
    hud.results(resultRows, resultsHint);
  };
  /** After the lobby, friends can still join: a card on results and countdown, a small chip while racing. */
  const joinMode = (phase: string): JoinMode =>
    phase === 'results' || phase === 'countdown' ? 'card' : phase === 'racing' ? 'chip' : 'none';

  // Phones hear about changes every 100 ms; the lobby screen refreshes on the same beat.
  const tick = (): void => {
    session.syncPhones();
    const phase = game.race.phase;
    const message = phase === 'lobby' || phase === 'results' ? roomError : null;
    if (message !== shownMessage) hud.message((shownMessage = message));
    if (phase === 'lobby') hud.lobby(roomCode, qrDataUrl, roomUrl, session.lobbySlots(), hostHint(true));
    else if (phase === 'results' && hostHint(false) !== resultsHint) showResults(false);
    hud.join(roomCode, qrSmallUrl, roomUrl, joinMode(phase));
  };
  tick();
  window.setInterval(tick, SYNC_MS);

  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime() / 1000;
    stepper.advance(dt, (h) => {
      for (const e of game.step(h, drivers)) {
        sounds.raceEvent(e, game.humanKartIds());
        if (e.kind === 'countdown') hud.countdown(e.n);
        else if (e.kind === 'go') {
          hud.countdown('GO');
          if (giveItem && getPowerup(giveItem)) {
            // DEV ONLY: see `?give` above.
            const slot = registry.byToken(KEYBOARD_TOKEN)?.slot;
            for (const k of game.karts) if (k.id === slot) k.item = giveItem;
          }
        }
        else if (e.kind === 'finish') session.sendEvent(e.kartId, 'finish');
        else if (e.kind === 'results') {
          showResults(true);
          hud.join(roomCode, qrSmallUrl, roomUrl, 'card');
        }
      }
      // A hit on a human kart gives the shared camera a soft shake.
      const humans = game.humanKartIds();
      for (const id of session.flushKartEvents()) if (humans.indexOf(id) >= 0) rig.addTrauma(HIT_TRAUMA);
    });
    frameWallHits = game.drainWallHits();
    sounds.frame(soundSource, performance.now());
    const phase = game.race.phase;
    if (phase === 'countdown' || phase === 'racing') hud.race(rowsFor());

    views.update(game.karts);
    entities.update(game.itemBoxes, game.world.entities, Math.min(0.1, dt));
    sparks.update(game.karts, frameWallHits, Math.min(0.1, dt));
    const humanIds = game.humanKartIds();
    framed.length = 0;
    // Lobby: the whole track (no points); then the camera eases in on the humans' karts.
    if (phase !== 'lobby') {
      for (const k of game.karts) if (humanIds.length === 0 || humanIds.indexOf(k.id) >= 0) framed.push(k.pos);
    }
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
