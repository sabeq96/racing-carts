import { INPUT_HZ, KART_COLORS, type ClientMsg, type ServerMsg } from '@rc/shared';
import { connect, type Link } from './connection';
import { gravityToRollDeg, rollToSteer } from './tilt';
import './style.css';

type StateMsg = Extract<ServerMsg, { t: 'state' }>;
type Screen = 'join' | 'lobby' | 'drive';

const SAMPLE_WAIT_MS = 1000;
const SETTLE_MS = 200;
const FALLBACK_NAME_MAX = 12;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  banner: $('banner'),
  form: $<HTMLFormElement>('joinForm'),
  roomChip: $('roomChip'),
  roomChipCode: $('roomChipCode'),
  codeInput: $<HTMLInputElement>('codeInput'),
  nameInput: $<HTMLInputElement>('nameInput'),
  joinError: $('joinError'),
  startBtn: $<HTMLButtonElement>('startBtn'),
  swatch: $('swatch'),
  lobbyName: $('lobbyName'),
  startRaceBtn: $<HTMLButtonElement>('startRaceBtn'),
  waitMsg: $('waitMsg'),
  statusText: $('statusText'),
  meterFill: $('meterFill'),
  centerBtn: $<HTMLButtonElement>('centerBtn'),
  itemPad: $<HTMLButtonElement>('itemPad'),
  itemIcon: $('itemIcon'),
  steerBtns: $('steerBtns'),
  leftBtn: $<HTMLButtonElement>('leftBtn'),
  rightBtn: $<HTMLButtonElement>('rightBtn'),
  brakePad: $<HTMLButtonElement>('brakePad'),
  gasPad: $<HTMLButtonElement>('gasPad'),
  results: $('results'),
  resultText: $('resultText'),
  rematchBtn: $<HTMLButtonElement>('rematchBtn'),
  resultWait: $('resultWait'),
};

// ---------- small helpers ----------

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // storage can be blocked (private mode); the app works without it
  }
  return null;
}

function makeToken(): string {
  const existing = store('rc.token');
  if (existing) return existing;
  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  store('rc.token', token);
  return token;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Mixes a #rrggbb colour with `base` (also #rrggbb) by `amount` (0 = base, 1 = colour). */
function mix(hex: string, base: string, amount: number): string {
  const ch = (h: string, i: number): number => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const v = Math.round(ch(base, i) + (ch(hex, i) - ch(base, i)) * amount);
    out += v.toString(16).padStart(2, '0');
  }
  return out;
}

function setKartColor(color: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
  document.documentElement.style.setProperty('--kart', color);
  document.documentElement.style.setProperty('--bg', mix(color, '#fff3e4', 0.4));
}

// ---------- app state ----------

const params = new URLSearchParams(location.search);
const addressParam = (params.get('address') ?? '').trim().toUpperCase();
const demo = params.get('demo');

let link: Link | null = null;
let name = '';
let welcomed = false;
let lastState: StateMsg | null = null;
let isHost = false;
let buttonSteer = false;
let started = false;

// controls
let gas = false;
let brake = false;
let item = false;
let left = false;
let right = false;

// tilt
let roll = 0;
let neutral = 0;
let haveSample = false;
let demoSteer: number | null = null;
let motionListening = false;

// ---------- rendering ----------

function currentScreen(): Screen {
  if (!welcomed) return 'join';
  if (!lastState || lastState.phase === 'lobby') return 'lobby';
  return 'drive';
}

function render(): void {
  const screen = currentScreen();
  document.body.dataset.screen = screen;

  els.banner.hidden = !(link && link.status === 'retrying');

  if (screen === 'lobby') {
    els.startRaceBtn.hidden = !isHost;
    els.waitMsg.hidden = isHost;
    els.lobbyName.textContent = name;
  }

  if (screen === 'drive' && lastState) {
    const s = lastState;
    const inResults = s.phase === 'results';
    els.statusText.textContent =
      s.phase === 'countdown' ? 'Get ready!' : `${ordinal(s.position)} · Lap ${Math.min(s.lap, s.totalLaps)}/${s.totalLaps}`;

    const empty = !s.rolling && !s.itemIcon;
    els.itemIcon.textContent = s.rolling ? '🎲' : (s.itemIcon ?? '🎁');
    els.itemPad.classList.toggle('rolling', s.rolling);
    els.itemPad.classList.toggle('empty', empty);

    els.results.hidden = !inResults;
    if (inResults) {
      els.resultText.textContent = `${s.position === 1 ? '🏆 ' : ''}You finished ${ordinal(s.position)}!`;
      els.rematchBtn.hidden = !s.isHost;
      els.resultWait.hidden = s.isHost;
    }
  } else {
    els.results.hidden = true;
  }

  els.steerBtns.hidden = !buttonSteer;
}

function showMeter(steer: number): void {
  const half = Math.min(1, Math.abs(steer)) * 50;
  els.meterFill.style.width = `${half}%`;
  els.meterFill.style.left = steer < 0 ? `${50 - half}%` : '50%';
}

function showJoinError(text: string): void {
  els.joinError.textContent = text;
  els.joinError.hidden = !text;
}

function setBusy(busy: boolean): void {
  els.startBtn.disabled = busy;
  els.startBtn.textContent = busy ? 'Joining…' : 'Tap to start';
}

// ---------- tilt + steering ----------

function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return typeof a === 'number' ? a : 0;
}

function onMotion(e: DeviceMotionEvent): void {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null || g.y == null) return;
  roll = gravityToRollDeg(g.x, g.y, screenAngle());
  haveSample = true;
}

function recenter(): void {
  if (haveSample) neutral = roll;
}

function currentSteer(): number {
  if (demoSteer !== null) return demoSteer;
  if (buttonSteer) return (right ? 1 : 0) - (left ? 1 : 0);
  return haveSample ? rollToSteer(roll, neutral) : 0;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Starts listening to the accelerometer; resolves true if a real sample arrived in time. */
function startMotion(): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    if (!motionListening) {
      motionListening = true;
      window.addEventListener('devicemotion', (e) => {
        onMotion(e);
        if (haveSample) finish(true);
      });
    }
    setTimeout(() => finish(haveSample), SAMPLE_WAIT_MS);
  });
}

interface PermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

async function askMotionPermission(): Promise<boolean> {
  const api: PermissionApi | undefined =
    typeof DeviceMotionEvent !== 'undefined'
      ? (DeviceMotionEvent as unknown as PermissionApi)
      : typeof DeviceOrientationEvent !== 'undefined'
        ? (DeviceOrientationEvent as unknown as PermissionApi)
        : undefined;
  if (!api || typeof api.requestPermission !== 'function') return true;
  try {
    return (await api.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

// wake lock + landscape

let wakeLock: WakeLockSentinel | null = null;

async function requestWakeLock(): Promise<void> {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (started && document.visibilityState === 'visible') void requestWakeLock();
});

async function goLandscape(): Promise<void> {
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    // fullscreen is optional; it only helps Android allow the orientation lock
  }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    // not supported or not allowed; the "turn your phone" hint covers it
  }
}

// ---------- joining ----------

async function start(): Promise<void> {
  if (started) return;
  const code = (addressParam || els.codeInput.value).trim().toUpperCase();
  if (code.length < 4) {
    showJoinError('Type the 4 letters from the TV');
    els.codeInput.focus();
    return;
  }
  started = true;
  showJoinError('');
  setBusy(true);
  name = els.nameInput.value.trim().slice(0, FALLBACK_NAME_MAX);
  store('rc.name', name);

  // Permission prompts must be requested straight from the tap, before anything slow.
  const granted = await askMotionPermission();
  void goLandscape();

  if (granted) {
    const got = await startMotion();
    if (got) {
      await sleep(SETTLE_MS);
      neutral = roll;
    } else {
      buttonSteer = true;
    }
  } else {
    buttonSteer = true;
  }

  void requestWakeLock();

  const token = makeToken();
  link = connect(
    code,
    { token, name },
    onServerMsg,
    () => render(),
  );
  render();
}

function onServerMsg(m: ServerMsg): void {
  switch (m.t) {
    case 'welcome':
      welcomed = true;
      setKartColor(m.color);
      render();
      break;
    case 'state': {
      const wasCountdown = lastState?.phase === 'countdown';
      lastState = m;
      isHost = m.isHost;
      // hands are on the wheel by the time the countdown starts: take that as straight ahead
      if (m.phase === 'countdown' && !wasCountdown) recenter();
      render();
      break;
    }
    case 'event':
      if (m.kind === 'hit') navigator.vibrate?.(200);
      break;
    case 'lobbyFull':
      link?.close();
      link = null;
      started = false;
      welcomed = false;
      lastState = null;
      setBusy(false);
      showJoinError('Game is full (6/6)');
      render();
      break;
  }
}

// ---------- input sending ----------

function sendInput(): void {
  const steer = currentSteer();
  showMeter(steer);
  if (!link || link.status !== 'open') return;
  link.send({ t: 'input', steer, gas, brake, item } satisfies ClientMsg);
}

setInterval(sendInput, 1000 / INPUT_HZ);

// ---------- buttons ----------

/** Hold-to-press button using pointer events, so several fingers work at once. */
function holdButton(el: HTMLElement, set: (down: boolean) => void): void {
  const active = new Set<number>();
  const update = (): void => {
    const down = active.size > 0;
    el.classList.toggle('pressed', down);
    set(down);
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // capture can fail for synthetic pointers
    }
    active.add(e.pointerId);
    update();
  });
  const release = (e: PointerEvent): void => {
    if (active.delete(e.pointerId)) update();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

holdButton(els.gasPad, (d) => (gas = d));
holdButton(els.brakePad, (d) => (brake = d));
holdButton(els.itemPad, (d) => (item = d));
holdButton(els.leftBtn, (d) => (left = d));
holdButton(els.rightBtn, (d) => (right = d));

els.centerBtn.addEventListener('click', recenter);
els.startRaceBtn.addEventListener('click', () => link?.send({ t: 'start' }));
els.rematchBtn.addEventListener('click', () => link?.send({ t: 'rematch' }));

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  void start();
});

// stop the browser from scrolling/zooming while driving
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- boot ----------

els.nameInput.value = store('rc.name') ?? '';
if (addressParam) {
  els.codeInput.hidden = true;
  els.roomChip.hidden = false;
  els.roomChipCode.textContent = addressParam;
}
els.codeInput.addEventListener('input', () => {
  els.codeInput.value = els.codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
});

/** Dev-only preview: ?demo=1 (driving), ?demo=lobby, ?demo=results; &slot=0..5 picks the kart colour. */
function runDemo(kind: string): void {
  const slot = Number(params.get('slot') ?? 2) % KART_COLORS.length;
  setKartColor(KART_COLORS[slot]);
  name = els.nameInput.value || 'Sam';
  welcomed = true;
  isHost = true;
  buttonSteer = params.get('buttons') === '1';
  lastState = {
    t: 'state',
    phase: kind === 'lobby' ? 'lobby' : kind === 'results' ? 'results' : 'racing',
    isHost: true,
    position: kind === 'results' ? 2 : 3,
    racers: 6,
    lap: 2,
    totalLaps: 3,
    item: kind === 'results' ? null : 'rocket',
    itemIcon: kind === 'results' ? null : '🚀',
    rolling: params.get('rolling') === '1',
  };
  render();
  demoSteer = 0.45;
  showMeter(demoSteer);
}

if (demo) {
  runDemo(demo);
} else {
  render();
}
