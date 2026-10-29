# Racing Carts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cozy couch kart racer. A 2022 Samsung TV runs and renders a 6-kart Babylon.js race, and phones join via a PeerJS room code and steer by tilting.

**Architecture:** An npm-workspaces monorepo with three packages:
- `apps/game`: Babylon.js + Vite, shipped as a Tizen `.wgt`.
- `apps/controller`: vanilla TS, deployed to GitHub Pages.
- `packages/shared`: the protocol.

The TV is authoritative. All simulation is pure TS on plain data objects and runs at a fixed 60 Hz; Babylon only reads that state to render it. Every kart is driven by the same `InputSnapshot`, whether it comes from a phone, the keyboard, or a bot.

**Tech Stack:**
- TypeScript, Vite, Vitest
- `@babylonjs/core`
- `peerjs` (public broker)
- `qrcode`
- Tizen CLI (on the user's machine, only for packaging)

**Spec:** `docs/superpowers/specs/2026-10-29-racing-carts-design.md`

## Global Constraints

- **Look and feel:** small, simple, cozy, intuitive.
  - Pastel colours, warm light, chunky rounded low-poly shapes, big type, few words.
  - No real-time shadows; a blob shadow sits under each kart. No post-processing.
- **Builds:**
  - The game build targets `chrome85` (Vite `build.target` and esbuild/oxc target) and uses `base: './'`.
  - The controller uses `base: '/racing-carts/'`.
- **PeerJS:**
  - Peer ID is `racingcarts-<CODE>`.
  - Room code: 4 letters from `ABCDEFGHJKMNPQRSTUVWXYZ`.
  - Controller URL: `https://sabeq96.github.io/racing-carts/?address=<CODE>`.
- **Race rules:**
  - `MAX_PLAYERS = 6`, and bots fill empty slots.
  - `TOTAL_LAPS = 3`.
  - Countdown is 3 s.
  - The phone sends input at 30 Hz.
- **Kart colours by slot:**
  - coral `#FF8A80`
  - sky `#82B1FF`
  - mint `#9BE7C4`
  - butter `#FFE38A`
  - lavender `#C9B6F2`
  - peach `#FFC09F`
- **Camera:**
  - One shared camera.
  - Fits all human karts, or all karts when there are no humans.
  - Never zooms out beyond whole-track view.
  - **No respawn.** Walls everywhere; karts can't leave the track.
- **Items:**
  - One held item per kart. A box gives nothing while an item is held or rolling.
  - The roll lasts 1 s. A taken box respawns after 3 s.
- **Items and timing values:**
  - Shield: 6 s, or until the first hit.
  - Boost: +60% top speed for 1.5 s.
  - Mine: drops behind the kart, spins the first kart that touches it for 1.2 s, lasts 30 s.
  - Rocket: homes on the next kart ahead.
- **Physics conventions:**
  - The world is the ground plane `(x, z)`.
  - Heading `θ` gives `forward = (sin θ, cos θ)` and `right = (cos θ, −sin θ)`.
  - `steer > 0` turns right, so the heading increases.
  - Positive `lateral` means right of the track direction.
- **Placeholder audio:** silent mp3s at `apps/game/public/audio/<name>.mp3`. A missing or undecodable file must never break the game.

## Review Focus

1. **Phone drops mid-race and reopens the page** (same token) → it gets the same kart back; a bot drove it meanwhile (Task 2 test, Task 9 test).
2. **Phone joins while a race is running** (new token, free slot) → it takes over that slot's bot kart immediately. A 7th phone gets `lobbyFull` (Task 2 test).
3. **Host phone leaves** → the earliest-joined remaining connected player becomes host, and their phone shows the host buttons (Task 2 test, Task 9 state sync).
4. **Malformed or out-of-range messages** (NaN, `steer: 100`, missing fields, non-objects, a 50-character name) → clamped or dropped, never a crash (Task 1 test).
5. **Driving backwards over the start line, or the hairpin's two sides being close** → no lap gained and no position jump (Task 7 test).

---

## File Structure

```
package.json                     workspaces, root scripts (test, typecheck, build)
tsconfig.base.json
packages/shared/src/index.ts     re-exports
packages/shared/src/protocol.ts  constants, message types, decode*, makeRoomCode
apps/controller/
  index.html, src/style.css
  src/tilt.ts                    gravity → roll → steer (pure)
  src/connection.ts              PeerJS client with auto-retry
  src/main.ts                    screens + input loop
apps/game/
  index.html, vite.config.ts
  public/config.xml, public/icon.png, public/audio/*.mp3
  scripts/package-tizen.sh, scripts/make-silent-audio.sh
  src/main.ts                    boot: URL params, engine, Game, host
  src/math/vec2.ts
  src/net/players.ts             PlayerRegistry (pure)
  src/net/host.ts                PeerJS host wrapper
  src/probe.ts                   ?probe=1 diagnostic screen
  src/track/trackDef.ts          v1 track data
  src/track/track.ts             buildTrack(): sampling, projection, grid, boxes
  src/kart/tuning.ts, src/kart/kart.ts
  src/race/progress.ts           distance, laps, positions
  src/race/race.ts               phase machine + race events
  src/loop.ts                    FixedStepper
  src/input/keyboard.ts
  src/bots/bot.ts
  src/powerups/types.ts, registry.ts, roll.ts, world.ts, itemBoxes.ts, useItem.ts
  src/powerups/items/shield.ts, boost.ts, mine.ts, rocket.ts
  src/game.ts                    orchestrator (pure-ish; no Babylon imports)
  src/render/scene.ts, kartViews.ts, entityViews.ts, camera.ts, hud.ts
  src/audio/audio.ts, src/audio/manifest.ts
docs/tizen-sideload.md, docs/audio-assets.md
.github/workflows/deploy-controller.yml
```

Tests are placed next to the code they cover as `*.test.ts`.

---

### Task 1: Monorepo scaffold + shared protocol

**Files:**
- Create:
  - `package.json`, `tsconfig.base.json`, `.gitignore` (`node_modules`, `dist`, `*.wgt`)
  - `packages/shared/package.json` (name `@rc/shared`, `"exports": {".": "./src/index.ts"}`, scripts `test: vitest run`, `typecheck: tsc --noEmit`)
  - `packages/shared/tsconfig.json`
  - `packages/shared/src/protocol.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/protocol.test.ts`

**Interfaces:**
- Produces, from `@rc/shared`:
```ts
export const PEER_PREFIX = 'racingcarts-';
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const MAX_PLAYERS = 6, TOTAL_LAPS = 3, INPUT_HZ = 30;
export const KART_COLORS: readonly string[];   // 6 hex values from Global Constraints, slot order
export const CONTROLLER_URL = 'https://sabeq96.github.io/racing-carts/';
export type Phase = 'lobby' | 'countdown' | 'racing' | 'results';
export interface InputSnapshot { steer: number; gas: boolean; brake: boolean; item: boolean }
export type ClientMsg =
  | { t: 'hello'; token: string; name: string }
  | ({ t: 'input' } & InputSnapshot)
  | { t: 'start' } | { t: 'rematch' };
export type ServerMsg =
  | { t: 'welcome'; slot: number; color: string }
  | { t: 'state'; phase: Phase; isHost: boolean; position: number; racers: number;
      lap: number; totalLaps: number; item: string | null; itemIcon: string | null; rolling: boolean }
  | { t: 'event'; kind: 'hit' | 'itemGot' | 'finish' }
  | { t: 'lobbyFull' };
export function makeRoomCode(rand?: () => number): string;   // 4 chars of ROOM_ALPHABET
export function peerIdFor(code: string): string;              // PEER_PREFIX + code.toUpperCase()
export function controllerUrl(code: string): string;          // CONTROLLER_URL + '?address=' + code
export function decodeClient(raw: unknown): ClientMsg | null;
export function decodeServer(raw: unknown): ServerMsg | null;
export const NEUTRAL_INPUT: InputSnapshot;                     // steer 0, all false
```
- Messages travel as plain objects (PeerJS `serialization: 'json'`). `decode*` also accepts a JSON string.

- [ ] **Step 1: Write root config.**
  - Root `package.json`: `"private": true`, `"workspaces": ["packages/*", "apps/*"]`, `"type": "module"`, and scripts:
    - `"test": "npm run test --workspaces --if-present"`
    - `"typecheck": "npm run typecheck --workspaces --if-present"`
  - `tsconfig.base.json`: `strict`, `target ES2020`, `module ESNext`, `moduleResolution Bundler`, `lib ["ES2020","DOM","DOM.Iterable"]`, `skipLibCheck`, `noEmit`.
  - Dev deps at root: `typescript`, `vitest`, `vite` (latest majors; at plan time: TS 7, Vitest 5, Vite 8). If `tsc` from TS 7 misbehaves, pin `typescript@^5.9` and note it in the commit.

- [ ] **Step 2: Write the failing tests** in `protocol.test.ts`:
```ts
test('makeRoomCode uses 4 unambiguous letters', () => {
  expect(makeRoomCode(() => 0)).toBe('AAAA');
  expect(makeRoomCode(() => 0.9999)).toBe('ZZZZ');
  for (let i = 0; i < 200; i++) expect(makeRoomCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
});
test('peerIdFor / controllerUrl', () => {
  expect(peerIdFor('kart')).toBe('racingcarts-KART');
  expect(controllerUrl('KART')).toBe('https://sabeq96.github.io/racing-carts/?address=KART');
});
test('decodeClient accepts valid messages and JSON strings', () => {
  expect(decodeClient({ t: 'start' })).toEqual({ t: 'start' });
  expect(decodeClient('{"t":"hello","token":"abc","name":"Ola"}')).toEqual({ t: 'hello', token: 'abc', name: 'Ola' });
});
test('decodeClient clamps and sanitises input', () => {
  expect(decodeClient({ t: 'input', steer: 100, gas: 1, brake: false, item: 'yes' }))
    .toEqual({ t: 'input', steer: 1, gas: true, brake: false, item: true });
  expect(decodeClient({ t: 'input', steer: NaN })).toEqual({ t: 'input', steer: 0, gas: false, brake: false, item: false });
});
test('decodeClient trims hello name to 12 chars and defaults empty to "Player"', () => {
  expect((decodeClient({ t: 'hello', token: 'x', name: 'A'.repeat(50) }) as any).name).toHaveLength(12);
  expect((decodeClient({ t: 'hello', token: 'x', name: '   ' }) as any).name).toBe('Player');
});
test('decodeClient rejects garbage', () => {
  for (const bad of [null, 42, 'not json', {}, { t: 'nope' }, { t: 'hello', name: 'x' }, { t: 'hello', token: '' }])
    expect(decodeClient(bad)).toBeNull();
});
test('decodeServer round-trips a state message', () => {
  const s = { t: 'state', phase: 'racing', isHost: true, position: 2, racers: 6, lap: 1, totalLaps: 3, item: null, itemIcon: null, rolling: false };
  expect(decodeServer(JSON.stringify(s))).toEqual(s);
  expect(decodeServer({ t: 'bogus' })).toBeNull();
});
```

- [ ] **Step 3: Run the tests.** `npm install && npm test -w @rc/shared` should FAIL because the module isn't found.

- [ ] **Step 4: Implement `protocol.ts` and `index.ts`.**
  - Booleans are coerced with `Boolean()`. `steer` uses `Number.isFinite` and is clamped to [-1, 1].
  - Tokens must be non-empty strings of at most 64 chars.
  - `decodeServer` checks only `t` and copies the known fields.

- [ ] **Step 5: Run the tests.** `npm test -w @rc/shared && npm run typecheck` should PASS.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat: monorepo scaffold and shared protocol"`

---

### Task 2: Player registry + PeerJS host

**Files:**
- Create:
  - `apps/game/package.json` (name `game`; deps `@rc/shared: "*"`, `@babylonjs/core`, `peerjs`, `qrcode`; dev `@types/qrcode`; scripts `dev: vite`, `build: vite build`, `test: vitest run`, `typecheck: tsc --noEmit`)
  - `apps/game/tsconfig.json`
  - `apps/game/src/net/players.ts`, `apps/game/src/net/host.ts`
- Test: `apps/game/src/net/players.test.ts`

**Interfaces:**
- Produces:
```ts
// players.ts — pure, no PeerJS
export interface PlayerInfo { token: string; name: string; slot: number; connected: boolean; joinOrder: number }
export class PlayerRegistry {
  join(token: string, name: string, phase: Phase): { slot: number; rejoined: boolean } | 'full';
  disconnect(token: string, phase: Phase): void;   // lobby: removes player; other phases: connected=false, slot kept
  bySlot(slot: number): PlayerInfo | undefined;
  byToken(token: string): PlayerInfo | undefined;
  all(): PlayerInfo[];                              // sorted by slot
  hostToken(): string | null;                       // connected player with lowest joinOrder
}
// host.ts
export interface HostHandlers {
  onMessage(token: string, msg: ClientMsg): void;   // hello is handled inside host.ts and surfaced as onHello
  onHello(token: string, name: string): ServerMsg | null; // return lobbyFull to reject (host sends it and closes), else null
  onDisconnect(token: string): void;
}
export interface NetHost { code: string; send(token: string, msg: ServerMsg): void; close(): void }
export function startHost(handlers: HostHandlers, rand?: () => number): Promise<NetHost>;
```

- [ ] **Step 1: Write failing tests** in `players.test.ts`:
```ts
test('slots fill lowest-first and cap at 6', () => {
  const r = new PlayerRegistry();
  for (let i = 0; i < 6; i++) expect(r.join('t' + i, 'P' + i, 'lobby')).toEqual({ slot: i, rejoined: false });
  expect(r.join('t6', 'P6', 'lobby')).toBe('full');
});
test('lobby disconnect frees slot; next join reuses lowest free slot', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby'); r.join('b', 'B', 'lobby');
  r.disconnect('a', 'lobby');
  expect(r.join('c', 'C', 'lobby')).toEqual({ slot: 0, rejoined: false });
});
test('mid-race disconnect keeps slot; same token rejoins same slot', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby'); r.join('b', 'B', 'lobby');
  r.disconnect('a', 'racing');
  expect(r.bySlot(0)?.connected).toBe(false);
  expect(r.join('a', 'A', 'racing')).toEqual({ slot: 0, rejoined: true });
  expect(r.bySlot(0)?.connected).toBe(true);
});
test('new phone during race takes a free slot', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby');
  expect(r.join('z', 'Z', 'racing')).toEqual({ slot: 1, rejoined: false });
});
test('host is earliest-joined connected player and passes on', () => {
  const r = new PlayerRegistry(); r.join('a', 'A', 'lobby'); r.join('b', 'B', 'lobby');
  expect(r.hostToken()).toBe('a');
  r.disconnect('a', 'racing'); expect(r.hostToken()).toBe('b');
  r.join('a', 'A', 'racing'); expect(r.hostToken()).toBe('a');
});
```

- [ ] **Step 2: Run the tests.** `npm test -w game` should FAIL.

- [ ] **Step 3: Implement `PlayerRegistry`.**
  - A rejoin keeps the original `joinOrder` but updates `name`.
  - `join` during `results` or `countdown` behaves the same as during `racing`.

- [ ] **Step 4: Run the tests.** `npm test -w game` should PASS.

- [ ] **Step 5: Implement `startHost`** (manual verification happens in Task 4).
  - Create `new Peer(peerIdFor(makeRoomCode(rand)))`.
  - On error `type === 'unavailable-id'`, retry with a new code.
  - On `network` / `server-error` / `socket-error`, reject with `Error('broker-unreachable')` so the caller can show the message and retry.
  - On `connection`:
    - Wait for the first message. It must decode to `hello`, otherwise close the connection.
    - Call `onHello`. If it returns `lobbyFull`, send it and close.
    - Otherwise map token→connection. A newer connection for the same token replaces the old one.
    - Route later decoded messages to `onMessage`.
    - On `close`/`error`, call `onDisconnect` only if the closed connection is still the current one for that token.

- [ ] **Step 6: Commit.** `git commit -am "feat(game): player registry and PeerJS host"` (also `git add` the new files).

---

### Task 3: Controller app

**Files:**
- Create:
  - `apps/controller/package.json` (name `controller`; deps `@rc/shared`, `peerjs`; scripts `dev`, `build`, `test`, `typecheck`)
  - `apps/controller/vite.config.ts` (`base: '/racing-carts/'`)
  - `apps/controller/tsconfig.json`, `apps/controller/index.html`
  - `apps/controller/src/style.css`, `src/tilt.ts`, `src/connection.ts`, `src/main.ts`
- Test: `apps/controller/src/tilt.test.ts`

**Interfaces:**
- Consumes: `@rc/shared` (`decodeServer`, `peerIdFor`, `INPUT_HZ`, `ClientMsg`, `ServerMsg`).
- Produces:
```ts
// tilt.ts
export function gravityToRollDeg(gx: number, gy: number, screenAngleDeg: number): number;
export function rollToSteer(rollDeg: number, neutralDeg: number): number; // dead-zone 3°, full lock 30°, clamp ±1
// connection.ts
export interface Link { send(msg: ClientMsg): void; status: 'connecting' | 'open' | 'retrying' }
export function connect(code: string, hello: { token: string; name: string },
  onMsg: (m: ServerMsg) => void, onStatus: (s: Link['status']) => void): Link;
```
- **Tilt algorithm** (sign-agnostic: the neutral roll is captured at "Tap to start", and only the difference is used, so iOS's inverted gravity sign cancels out):
  - Rotate device gravity into screen coordinates with `a` = screen angle in radians: `sx = gx·cos a − gy·sin a`, `sy = gx·sin a + gy·cos a`.
  - Then `roll = atan2(−sx, sy)` in degrees.
  - `rollToSteer` wraps `roll − neutral` into (−180, 180], applies the 3° dead-zone, and computes `sign·min(1, (|d|−3)/27)`.

- [ ] **Step 1: Write failing tests** in `tilt.test.ts`:
```ts
test('level portrait-up wheel = 0°', () => expect(gravityToRollDeg(0, 9.8, 0)).toBeCloseTo(0));
test('turned right 30° in portrait', () => expect(gravityToRollDeg(-4.9, 8.487, 0)).toBeCloseTo(30, 0));
test('turned right 30° in landscape (angle 90)', () => expect(gravityToRollDeg(8.487, 4.9, 90)).toBeCloseTo(30, 0));
test('inverted gravity sign (iOS) still steers correctly after calibration', () => {
  const neutral = gravityToRollDeg(0, -9.8, 0);
  expect(rollToSteer(gravityToRollDeg(4.9, -8.487, 0), neutral)).toBeCloseTo(1);
});
test('rollToSteer dead-zone, linear, clamp, wrap', () => {
  expect(rollToSteer(2, 0)).toBe(0);
  expect(rollToSteer(16.5, 0)).toBeCloseTo(0.5);
  expect(rollToSteer(30, 0)).toBeCloseTo(1);
  expect(rollToSteer(-45, 0)).toBe(-1);
  expect(rollToSteer(-170, 180)).toBeCloseTo(7 / 27);
});
```

- [ ] **Step 2: Run the tests.** `npm test -w controller` should FAIL. **Step 3:** implement `tilt.ts`. **Step 4:** the tests should PASS.

- [ ] **Step 5: Implement `connection.ts`.**
  - Create `new Peer()` (random ID), then `peer.connect(peerIdFor(code), { serialization: 'json' })`.
  - On `open`, send `hello`.
  - On `close`/`error`, set status `retrying` and reconnect every 2 s, reusing the Peer unless it is destroyed.
  - Decode every incoming message with `decodeServer`.
  - Keep `send()` a no-op unless open.

- [ ] **Step 6: Implement `main.ts`, `index.html` and `style.css`.** There are three screens. All use big rounded buttons and a pastel palette, with the background tinted by the kart colour once `welcome` arrives.
  - **Join.**
    - Shows a code field, pre-filled from `?address` and hidden when present.
    - A name field (localStorage `rc.name`).
    - A big **Tap to start** button. On tap:
      - `await DeviceOrientationEvent/DeviceMotionEvent.requestPermission?.()` if the function exists.
      - Listen to `devicemotion` `accelerationIncludingGravity`.
      - Wait about 200 ms for a sample, then store it as the neutral roll.
      - `navigator.wakeLock?.request('screen')` (re-request on `visibilitychange`).
      - `screen.orientation?.lock?.('landscape').catch(() => {})`.
      - Then `connect`.
    - The token comes from localStorage `rc.token`, or `crypto.randomUUID()` (fallback `Math.random().toString(36)`).
    - If permission is denied, or no motion event arrives within 1 s, set `buttonSteer = true` and show ◀ ▶ buttons.
  - **Waiting / lobby.**
    - Shows "You're in!" plus a colour swatch.
    - The host sees **Start race** (sends `start`); others see "Waiting for host…".
  - **Drive.** Landscape layout.
    - Left half is **ITEM** (icon, 🎲 while rolling, faded when empty).
    - Right half is **GAS**.
    - A small **BRAKE** button.
    - A tilt meter bar at the top.
    - Status "3rd · Lap 2/3".
    - On results: "You finished 2nd!" plus a **Rematch** button for the host.
    - Use `pointerdown`/`pointerup`/`pointercancel` with multi-touch, and `touch-action: none`.
    - Send `input` every `1000 / INPUT_HZ` ms while open.
  - On `event.hit`, call `navigator.vibrate?.(200)`.
  - `lobbyFull` shows "Game is full (6/6)".
  - Status `retrying` shows a "Reconnecting…" banner.
  - A **re-center** button re-captures the neutral roll.

- [ ] **Step 7: Verify the controller builds.** `npm run build -w controller` should succeed and produce `apps/controller/dist/index.html`. Then `npm run typecheck`.

- [ ] **Step 8: Commit.** `git add -A && git commit -m "feat(controller): tilt controller page"`

---

### Task 4: Connectivity probe on the TV + packaging + Pages deploy (USER CHECKPOINT)

**Files:**
- Create:
  - `apps/game/index.html` (full-screen `<canvas id="c">` + `<div id="hud">`)
  - `apps/game/vite.config.ts`
  - `apps/game/src/main.ts`, `apps/game/src/probe.ts`
  - `apps/game/public/config.xml`, `apps/game/public/icon.png`
  - `apps/game/scripts/package-tizen.sh`
  - `docs/tizen-sideload.md`
  - `.github/workflows/deploy-controller.yml`
- Modify: root `package.json` (add `"build:tv": "npm run build -w game && bash apps/game/scripts/package-tizen.sh"`)

**Interfaces:**
- Consumes:
  - `startHost` and `PlayerRegistry` (Task 2).
  - `controllerUrl` (Task 1).
- Produces:
  - `main.ts` routes `?probe=1` → `runProbe(hud: HTMLElement)`, otherwise the game. Until Task 8, the game path also runs the probe.
  - `npm run build:tv`.

- [ ] **Step 1: Write `vite.config.ts`.**
  - `base: './'`, `build.target: 'chrome85'`.
  - Also set the dep-optimizer / transform target to `chrome85` (whichever option Vite 8 exposes).
  - `server.host: true`.

- [ ] **Step 2: Implement `probe.ts`.**
  - `startHost` with a `PlayerRegistry`.
  - Show the room code (large), a QR code (`QRCode.toDataURL(controllerUrl(code), { width: 320, margin: 1 })`), and the URL text.
  - Each connected player gets a coloured dot on a 2D canvas: `steer` moves it x ±40%, `gas` moves it up, `item` pulses it.
  - On `broker-unreachable`, show "No internet — can't create room" and retry every 5 s.

- [ ] **Step 3: Write `public/config.xml`** with this exact content:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="http://sabeq96.github.io/racingcarts" version="0.1.0" viewmodes="maximized">
  <access origin="*" subdomains="true"/>
  <tizen:application id="RcCarts001.RacingCarts" package="RcCarts001" required_version="2.3"/>
  <content src="index.html"/>
  <feature name="http://tizen.org/feature/screen.size.normal.1080.1920"/>
  <icon src="icon.png"/>
  <name>Racing Carts</name>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:profile name="tv-samsung"/>
  <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
```

- [ ] **Step 4: Create `icon.png`.** 512×423, peach `#FFC09F` background with a simple rounded coral kart silhouette. Use ImageMagick `convert` draw primitives.

- [ ] **Step 5: Write `package-tizen.sh`.**
  - Usage: `bash apps/game/scripts/package-tizen.sh [profile]`, default profile name `RacingCarts`.
  - Checks `command -v tizen`, otherwise prints the pointer to `docs/tizen-sideload.md` and exits 1.
  - Runs `tizen package -t wgt -s "$PROFILE" -- apps/game/dist`.
  - Prints the path of the resulting `.wgt`.

- [ ] **Step 6: Write `docs/tizen-sideload.md`.** Numbered steps for a newcomer:
  1. Install Tizen Studio (or CLI) plus the TV Extensions and Samsung Certificate Extension.
  2. TV: Apps → type `12345` → Developer Mode On, enter the PC IP, reboot the TV.
  3. Certificate Manager: create a **Samsung** certificate profile named `RacingCarts`, adding the TV's DUID.
  4. `sdb connect <TV_IP>` → `sdb devices`.
  5. `npm run build:tv`.
  6. `tizen install -n apps/game/dist/RacingCarts.wgt -t <device-name>`.
  7. To debug: `tizen run -p RcCarts001.RacingCarts -t <device>`, and Chrome DevTools via `sdb` port forwarding.
  8. Troubleshooting: certificate mismatch → reinstall after uninstalling; the dev mode IP must match.

- [ ] **Step 7: Write `deploy-controller.yml`.**
  - Triggers: `on: push: branches: [main]` + `workflow_dispatch`.
  - Permissions: `pages: write`, `id-token: write`, `contents: read`.
  - Steps: checkout → setup-node 22 with npm cache → `npm ci` → `npm run build -w controller` → `actions/upload-pages-artifact` (path `apps/controller/dist`) → `actions/deploy-pages`.

- [ ] **Step 8: Verify locally.**
  - `npm run build -w game` should succeed. `dist/` should contain `index.html`, `config.xml`, `icon.png`, and relative `./assets/...` paths.
  - Serve with `npx vite preview -w game`. Use Playwright to open `/?probe=1` and screenshot it.
  - Expected: either a room code + QR, or the "No internet" message if this sandbox can't reach `0.peerjs.com`. Both prove the UI path; record which one.

- [ ] **Step 9: Commit, push, and hand off the checkpoint to the user.**
  - Commit with `git add -A && git commit -m "feat: TV connectivity probe, Tizen packaging, controller deploy"`, then push.
  - Ask the user to:
    - (a) merge to `main` (or create `main` from this branch) and set Settings → Pages → Source = GitHub Actions;
    - (b) sideload per `docs/tizen-sideload.md`;
    - (c) open the app on the TV (the probe runs by default until Task 8), scan the QR with 2 phones, and confirm both dots move when tilting.
  - **Stop and wait for the result.**
  - If WebRTC fails on the TV, stop the plan and re-brainstorm the transport. The spec fallback is a `wss://` relay.

---

### Task 5: Track generation

**Files:**
- Create: `apps/game/src/math/vec2.ts`, `apps/game/src/track/trackDef.ts`, `apps/game/src/track/track.ts`
- Test: `apps/game/src/track/track.test.ts`

**Interfaces:**
- Produces:
```ts
// vec2.ts
export interface Vec2 { x: number; z: number }
// plus small helpers: add, sub, scale, len, dist, dot, norm, lerp, wrapAngle(rad) → (−π, π]
// trackDef.ts
export interface TrackDef { controlPoints: [number, number][]; width: number;
  itemBoxRows: number[]; itemBoxLaterals: number[] }
export const TRACK_V1: TrackDef;
// track.ts
export interface Track {
  points: Vec2[];        // centre line sampled every ~1 m, closed (last→first implied); points[0] is the start line
  length: number; width: number;
  pointAt(s: number, lateral?: number): Vec2;     // s wraps modulo length
  headingAt(s: number): number;
  project(p: Vec2, hintIndex?: number): { s: number; lateral: number; index: number };
  grid: { pos: Vec2; heading: number; s: number }[];   // 6 slots
  itemBoxes: Vec2[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };  // includes width/2 margin
}
export function buildTrack(def: TrackDef): Track;
```
- **`TRACK_V1`:**
  - `width: 12`.
  - Control points (closed Catmull-Rom; the start line is the first point, on the long straight):
    `[0,-40],[0,0],[0,40],[0,62],[12,84],[34,92],[55,82],[62,62],[48,34],[70,8],[56,-22],[44,-60],[24,-84],[6,-76]`
  - `itemBoxRows: [0.3, 0.7]` (fractions of length).
  - `itemBoxLaterals: [-4.5, -1.5, 1.5, 4.5]`.
  - The implementer may nudge points if the shape tests fail.
- **Algorithm:**
  - Sample the Catmull-Rom densely (20 per segment), then resample at 1 m arc length.
  - `project` with a hint searches ±30 indices around the hint (handling wrap), otherwise it scans all points. It returns `s = index + fractional projection on the segment`, and a signed lateral using `right = (cos θ, −sin θ)`.
  - Grid slot `i`: `s = −(6 + 6·⌊i/2⌋)`, lateral `i % 2 === 0 ? −3 : 3`.

- [ ] **Step 1: Write failing tests:**
```ts
const t = buildTrack(TRACK_V1);
test('length is a ~25–35 s lap', () => { expect(t.length).toBeGreaterThan(380); expect(t.length).toBeLessThan(650); });
test('samples ~1 m apart', () => t.points.forEach((p, i) => expect(dist(p, t.points[(i + 1) % t.points.length])).toBeLessThan(1.3)));
test('no two non-neighbouring sections closer than 1.5×width', () => {
  for (let i = 0; i < t.points.length; i += 3) for (let j = 0; j < t.points.length; j += 3) {
    const gap = Math.min(Math.abs(i - j), t.points.length - Math.abs(i - j));
    if (gap > 40) expect(dist(t.points[i], t.points[j])).toBeGreaterThan(t.width * 1.5);
  }
});
test('heading convention: start straight runs +z so heading≈0', () => expect(t.headingAt(0)).toBeCloseTo(0, 1));
test('project inverts pointAt', () => {
  const p = t.pointAt(123.4, 2.5); const r = t.project(p);
  expect(r.s).toBeCloseTo(123.4, 0); expect(r.lateral).toBeCloseTo(2.5, 1);
});
test('project with hint stays local near hairpin', () => {
  const s = 200; const r = t.project(t.pointAt(s, 0), Math.round(s)); expect(r.s).toBeCloseTo(s, 0);
});
test('grid has 6 slots behind start, 2 abreast', () => {
  expect(t.grid).toHaveLength(6); expect(t.grid[0].s).toBeLessThan(0);
  expect(dist(t.grid[0].pos, t.grid[1].pos)).toBeCloseTo(6, 0);
});
test('8 item boxes', () => expect(t.itemBoxes).toHaveLength(8));
```

- [ ] **Step 2: Run the tests.** `npm test -w game` should FAIL. **Step 3:** implement. **Step 4:** the tests should PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(game): track generation"`

---

### Task 6: Kart physics

**Files:**
- Create: `apps/game/src/kart/tuning.ts`, `apps/game/src/kart/kart.ts`
- Test: `apps/game/src/kart/kart.test.ts`

**Interfaces:**
- Consumes: `Track`, `Vec2` (Task 5), `InputSnapshot` (Task 1).
- Produces:
```ts
// tuning.ts
export const MAX_SPEED = 20, ACCEL = 12, BRAKE_DECEL = 24, REVERSE_MAX = 6, COAST_DECEL = 4,
  STEER_RATE = 2.4, GRIP = 6, KART_RADIUS = 1, WALL_RESTITUTION = 0.3, WALL_SPEED_KEEP = 0.8,
  SPIN_TIME = 1.2, BOOST_FACTOR = 1.6;
// kart.ts
export interface Effect { kind: string; remaining: number }
export interface Kart {
  id: number; color: string;
  pos: Vec2; vel: Vec2; heading: number; speed: number;  // speed = signed forward speed
  spin: number;                                           // seconds of spin-out left
  effects: Effect[];
  item: string | null; rolling: { left: number; item: string } | null; itemPressed: boolean;
  distance: number; trackIndex: number; finishedAt: number | null;
}
export function createKart(id: number, color: string, slot: Track['grid'][number]): Kart; // distance = slot.s
export function stepKart(k: Kart, input: InputSnapshot, track: Track, dt: number): { hitWall: boolean };
export function resolveKartCollisions(karts: Kart[]): Array<[number, number]>; // ids of bumped pairs
```
- **Physics per step:**
  1. If `spin > 0`: ignore input, decrease `spin`, `speed *= exp(−3·dt)`, `heading += 10·dt` (visual twirl).
  2. Otherwise:
     - Max speed is `MAX_SPEED·(boost ? BOOST_FACTOR : 1)`.
     - Gas accelerates toward max. Brake decelerates, and below 0 reverses down to `−REVERSE_MAX`. With neither, coast toward 0.
     - Above max, decelerate at `ACCEL`.
     - `heading += steer·STEER_RATE·min(1, |speed|/6)·sign(speed)·dt`.
  3. `vel += (forward·speed − vel)·min(1, GRIP·dt)`, then `pos += vel·dt`.
  4. Walls: project with `hintIndex = trackIndex`. If `|lateral| > width/2 − KART_RADIUS`, clamp the position back onto the limit, reflect the lateral component of `vel` with `WALL_RESTITUTION`, `speed *= WALL_SPEED_KEEP`, and return `hitWall: true`. Store `trackIndex`.
- **Spec deviations (intentional, simpler):**
  - There is no grass slowdown, because the walls sit at the road edge so karts never reach grass.
  - Karts are 6 cloned meshes rather than GPU instances; at 6 karts the cost is the same.
- **Collisions:** for each pair closer than `2·KART_RADIUS`, push each apart by half the overlap and swap 50% of their velocity along the normal.

- [ ] **Step 1: Write failing tests:**
  - A straight test track is built from `buildTrack({ controlPoints: long rounded rectangle 400×80, width: 12, itemBoxRows: [], itemBoxLaterals: [] })`.
  - Helper `run(k, input, seconds)` steps at 1/60.
```ts
test('full gas reaches but never exceeds MAX_SPEED', () => { /* 5 s gas; track max speed seen ≤ 20.01; final ≥ 19.5 */ });
test('boost effect raises top speed to 32', () => { /* effects=[{kind:'boost',remaining:99}], 5 s gas → speed > 30 */ });
test('coasting slows down; brake from rest reverses to ≥ −6', () => {});
test('steer > 0 increases heading (turns right)', () => {});
test('wall contact keeps kart inside and reports hitWall', () => {
  /* place kart lateral = 5.5 heading straight across the track at speed 15; within 1 s some step returns hitWall
     and |project(pos).lateral| ≤ 6 − 1 + 1e-6 at every step */ });
test('spin ignores gas', () => { /* spin=1.2, gas → speed does not increase */ });
test('overlapping karts get separated', () => { /* two karts 1 m apart → after resolve dist ≥ 2 − 1e-6; returns [[0,1]] */ });
```
  - Write each body in full, with the stated numbers as assertions.

- [ ] **Step 2: Run the tests** (they should FAIL). **Step 3:** implement. **Step 4:** the tests should PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(game): arcade kart physics"`

---

### Task 7: Race progress + race phases

**Files:**
- Create: `apps/game/src/race/progress.ts`, `apps/game/src/race/race.ts`
- Test: `apps/game/src/race/progress.test.ts`, `apps/game/src/race/race.test.ts`

**Interfaces:**
- Consumes: `Kart`, `Track`, `TOTAL_LAPS`, `Phase`.
- Produces:
```ts
// progress.ts
export function updateProgress(k: Kart, track: Track): void;  // uses project(k.pos, k.trackIndex); distance += wrapped Δs
export function lapOf(k: Kart, track: Track): number;           // clamp(⌊distance/length⌋ + 1, 1, TOTAL_LAPS)
export function isFinished(k: Kart, track: Track): boolean;    // distance ≥ TOTAL_LAPS·length
export function rankKarts(karts: Kart[]): Kart[];              // finished by finishedAt asc, then distance desc
// race.ts
export type RaceEvent =
  | { kind: 'countdown'; n: 3 | 2 | 1 } | { kind: 'go' }
  | { kind: 'lap'; kartId: number; lap: number } | { kind: 'finalLap'; kartId: number }
  | { kind: 'finish'; kartId: number; place: number } | { kind: 'results' };
export class Race {
  phase: Phase; time: number;   // time = seconds since GO
  start(): void;                // lobby|results → countdown (3 s)
  update(dt: number, karts: Kart[], track: Track, isHuman: (kartId: number) => boolean): RaceEvent[];
  backToLobby(): void;
}
```
- **Rules:**
  - Distance changes only while `racing`. During countdown, karts receive `NEUTRAL_INPUT` (enforced by the caller).
  - Δs is wrapped into (−length/2, length/2], so reversing reduces the distance.
  - A kart finishes on the first `isFinished`. `finishedAt = time`, and its place is its finish order.
  - The race goes to `results` when every human kart has finished, or 30 s after the first human finished. With no humans, it goes to `results` when all karts have finished.
  - Unfinished karts are ranked by distance.
  - A `lap` event fires when `lapOf` increases; `finalLap` fires when it becomes `TOTAL_LAPS`.

- [ ] **Step 1: Write failing tests** (use `TRACK_V1`, and move karts by setting `pos = track.pointAt(s)` and calling `updateProgress` stepwise in 2 m increments):
```ts
test('driving forward one full length completes a lap', () => { /* from s=-6 to length+1 → lapOf = 2 */ });
test('reversing over the start line does not gain a lap', () => { /* s from 5 back to -20 then forward to 5 → lapOf 1, distance ≈ 5 */ });
test('back-and-forth across the line 10× never exceeds 1 lap', () => {});
test('hairpin: walking s 180→260 in 2 m steps increases distance monotonically', () => {});
test('rankKarts: finished first by time, then by distance', () => {});
test('Race: countdown emits 3,2,1,go then racing', () => {});
test('Race: results when all humans finished', () => {});
test('Race: results 30 s after first human finish even if others still racing', () => {});
test('Race: lap and finalLap events', () => {});
```

- [ ] **Step 2: Run the tests** (they should FAIL). **Step 3:** implement. **Step 4:** the tests should PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(game): lap progress, ranking and race phases"`

---

### Task 8: Rendering, camera, keyboard, loop — drivable on desktop

**Files:**
- Create:
  - `apps/game/src/loop.ts`, `apps/game/src/input/keyboard.ts`
  - `apps/game/src/game.ts`
  - `apps/game/src/render/scene.ts`, `kartViews.ts`, `camera.ts`, `hud.ts`
- Modify: `apps/game/src/main.ts` (non-probe path runs the game)
- Test: `apps/game/src/loop.test.ts`, `apps/game/src/render/camera.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–7.
- Produces:
```ts
// loop.ts
export class FixedStepper { constructor(hz = 60); advance(realDt: number, step: (dt: number) => void): number } // clamps realDt to 0.25
// camera.ts (pure part)
export function fitCamera(points: Vec2[], aspect: number, bounds: Track['bounds']): { target: Vec2; radius: number };
//   radiusFor(spanX, spanZ) = max(spanX / aspect, spanZ) * 1.2 + 25; result clamped to [35, radiusFor(whole bounds)]
//   target = bbox centre of points (bounds centre when points is empty)
export const CAMERA_ALPHA = -Math.PI / 2, CAMERA_BETA = 0.9;
// keyboard.ts
export function createKeyboard(): { input(): InputSnapshot; onEnter(cb: () => void): void }
//   arrows/WASD steer+gas+brake, Space item, Enter = start/rematch
// game.ts — owns simulation; no Babylon imports
export interface Driver { kind: 'human' | 'bot'; name: string; input(): InputSnapshot }
export class Game {
  track: Track; karts: Kart[]; race: Race;
  constructor(track: Track);
  setupKarts(slotCount: number): void;              // creates karts on grid slots 0..n-1 with KART_COLORS
  step(dt: number, drivers: (kartId: number) => Driver): RaceEvent[]; // inputs → stepKart → collisions → progress → race.update
  humanKartIds(): number[];
}
// hud.ts — HTML overlay, big rounded pastel panels
export class Hud {
  lobby(code: string, qrDataUrl: string, url: string, slots: { name: string; color: string; bot: boolean; host: boolean }[]): void;
  countdown(n: number | 'GO'): void;
  race(rows: { name: string; color: string; lap: number; item: string | null }[]): void; // ordered by position
  results(rows: { name: string; color: string }[], hostHint: string): void;
  message(text: string | null): void;
}
```
- **`scene.ts` → `createScene(engine, track): Scene`:**
  - Sky clear colour pastel blue `#BFE3FF`.
  - `HemisphericLight` (warm, intensity 0.9) plus one `DirectionalLight` (0.6).
  - Ground: a pastel green plane sized to bounds + 60.
  - Road: a ribbon from left/right edge paths, warm grey `#C9C2BA`, with a white start stripe.
  - Walls: `CreateTube` along both edges, radius 0.6, alternating coral/cream segments every 6 m.
  - Scenery (seeded random, 40 items, ≥ width/2 + 6 from the centre line): lollipop trees (cylinder + sphere `#8FD6A0`) and rounded rocks (low-tessellation icosphere `#D9CFC1`).
  - All materials are `StandardMaterial`, with low specular and no shadows.
- **`kartViews.ts` → `KartViews.update(karts)`:**
  - Per kart a cloned mesh group: rounded body box in the kart colour, 4 dark cylinder wheels, a cream sphere head, and a dark translucent blob-shadow disc.
  - Syncs position/heading; tilts the body slightly with steering.
  - The bubble for an active `shield` effect is added in Task 11.
- **Camera:** an `ArcRotateCamera` with fixed alpha/beta. Each frame, lerp the target and radius toward `fitCamera(humanPositions || allPositions)` with factor `1 − exp(−3·dt)`.
- **`main.ts`:**
  - Reads `?keyboard=1` (default on for desktop dev) and `?bots=N` (default fills to 6).
  - Until Task 9 the game has no lobby: on Enter, `race.start()`.
  - Drivers: kart 0 is the keyboard; the others get `NEUTRAL_INPUT` until Task 10.

- [ ] **Step 1: Write failing tests** for `FixedStepper` and `fitCamera`:
```ts
test('FixedStepper runs floor(realDt*hz) steps and carries remainder', () => {
  const s = new FixedStepper(60); let n = 0;
  expect(s.advance(1 / 30 + 0.001, () => n++)).toBe(2); expect(s.advance(1 / 60, () => n++)).toBe(1);
});
test('FixedStepper clamps huge dt', () => expect(new FixedStepper(60).advance(5, () => {})).toBe(15));
test('fitCamera: single kart → min radius, centred', () => {
  const r = fitCamera([{ x: 10, z: 20 }], 16 / 9, b); expect(r.radius).toBe(35); expect(r.target).toEqual({ x: 10, z: 20 });
});
test('fitCamera: spread karts never exceed whole-track radius', () => { /* points at opposite bounds corners → radius == max */ });
```

- [ ] **Step 2: Run the tests** (they should FAIL). **Step 3:** implement all files. **Step 4:** the tests should PASS, along with `npm run typecheck`.

- [ ] **Step 5: Manual check.**
  - `npm run dev -w game`, then use Playwright: open `/?keyboard=1`, press Enter, hold ArrowUp for 3 s, and take a screenshot.
  - Expected: a pastel track, coloured karts on the grid, and the coral kart moving.
  - Inspect the screenshot and fix any visual problems before committing.

- [ ] **Step 6: Commit.** `git commit -m "feat(game): Babylon scene, shared camera, keyboard driving"`

---

### Task 9: Lobby + phones drive karts

**Files:**
- Create: `apps/game/src/session.ts` (glues `NetHost` + `PlayerRegistry` + `Game` + `Hud`)
- Modify: `apps/game/src/main.ts`, `apps/game/src/game.ts`
- Test: `apps/game/src/session.test.ts`

**Interfaces:**
- Consumes: `startHost`/`NetHost` (Task 2), `Game`, `Hud`, `Race`.
- Produces:
```ts
export class Session {
  constructor(game: Game, registry: PlayerRegistry, send: (token: string, msg: ServerMsg) => void,
              opts: { maxBots: number; keyboard?: { input(): InputSnapshot } });
  onHello(token: string, name: string): ServerMsg | null;    // lobbyFull or null (sends welcome itself)
  onMessage(token: string, msg: ClientMsg): void;            // input → latest per token; start/rematch only from host
  onDisconnect(token: string): void;
  driverFor(kartId: number): Driver;                         // connected human → their latest input; otherwise the bot driver
  syncPhones(): void;                                        // send `state` to each connected token if changed (JSON compare)
  sendEvent(kartId: number, kind: 'hit' | 'itemGot' | 'finish'): void;
  lobbySlots(): { name: string; color: string; bot: boolean; host: boolean }[];
}
```
- **Rules:**
  - Keyboard (when enabled) registers as token `'keyboard'`, name "Keyboard", at join time 0.
  - `start` from the host in `lobby` creates karts for `min(6, humans + maxBots)` slots (at least the humans), then `race.start()`.
  - `rematch` from the host in `results` resets the karts on the grid and calls `race.start()` (straight to countdown with the same lineup).
  - Input from a disconnected token is ignored, and so is input before `racing`.
  - `driverFor` for a slot with no connected human uses the bot driver. Until Task 10 that driver returns `NEUTRAL_INPUT`.
  - Slots beyond the kart count during a race simply have no kart.
  - `syncPhones` runs every 100 ms.
  - `state.position` comes from `rankKarts`.
  - `state.item`/`itemIcon`/`rolling` come from the kart (and the registry def icon, added in Task 11; until then null).
- **`main.ts`:** boots `startHost` → `Session`, shows `hud.lobby(...)` while the phase is `lobby`, and wires `race` events to `hud`. On `broker-unreachable` it shows `hud.message("No internet — can't create room")` and retries every 5 s. The probe stays reachable via `?probe=1`.

- [ ] **Step 1: Write failing tests** (with a fake `send` that records messages):
```ts
test('hello → welcome with slot colour; 7th → lobbyFull', () => {});
test('only host can start; start creates humans+bots karts and enters countdown', () => {});
test('phone input drives its kart only while racing', () => {});
test('disconnect mid-race → driverFor returns bot; rejoin with same token → human again, same kart', () => {});
test('new phone mid-race takes over a bot kart in a free slot', () => {});
test('host leaves → next player state has isHost true', () => {});
test('syncPhones sends state only when changed', () => {});
```

- [ ] **Step 2: Run the tests** (they should FAIL). **Step 3:** implement. **Step 4:** the tests should PASS, plus typecheck.

- [ ] **Step 5: Manual check.**
  - Use Playwright with `/?keyboard=1`.
  - Expected: the lobby shows a room code, QR, and the keyboard player in coral. Enter starts the countdown, and the race runs.
  - Take a screenshot of the lobby and check it is readable at TV distance (big type, few words).

- [ ] **Step 6: Commit.** `git commit -m "feat(game): lobby, phone players, reconnect and host handoff"`

---

### Task 10: Bots

**Files:**
- Create: `apps/game/src/bots/bot.ts`
- Modify: `apps/game/src/session.ts` (bot driver per kart)
- Test: `apps/game/src/bots/bot.test.ts`

**Interfaces:**
- Produces:
```ts
export interface BotBrain { speedFactor: number; lookahead: number; laneOffset: number; laneTimer: number; reaction: number }
export function createBotBrain(rand: () => number): BotBrain;
//   speedFactor 0.82–0.92 (relaxed), lookahead 9 m, laneOffset ∈ [−3, 3], re-picked every 3–6 s, reaction 0.2–0.5 s
export function botInput(b: BotBrain, k: Kart, track: Track, dt: number, rand: () => number): InputSnapshot;
//   target = track.pointAt(s + lookahead, laneOffset); steer = clamp(2·wrapAngle(angleTo(target) − heading), −1, 1)
//   gas = speed < MAX_SPEED·speedFactor·(boost ? BOOST_FACTOR : 1); brake = false; item = false (items added in Task 11)
```
- `Session` keeps one `BotBrain` per kart, created at race start.

- [ ] **Step 1: Write failing tests:**
```ts
test('a bot alone on TRACK_V1 finishes a lap within 45 simulated seconds without stalling', () => {
  /* createKart on grid 0; loop stepKart+updateProgress with botInput at 1/60; expect lapOf ≥ 2 before 45 s */ });
test('bot respects its speed cap', () => { /* max observed speed ≤ MAX_SPEED*speedFactor + 0.5 */ });
test('six bots finish 3 laps within 3 minutes with collisions on', () => {});
```

- [ ] **Step 2: Run the tests** (they should FAIL). **Step 3:** implement. **Step 4:** the tests should PASS.

- [ ] **Step 5: Manual check.** Use Playwright with `/?keyboard=1&bots=5` and press Enter. Take screenshots at 5 s and 15 s: bots should be spread along the track and the camera should frame the keyboard kart.

- [ ] **Step 6: Commit.** `git commit -m "feat(game): relaxed racing-line bots"`

---

### Task 11: Powerup system + shield + boost + item boxes

**Files:**
- Create:
  - `apps/game/src/powerups/types.ts`, `registry.ts`, `roll.ts`, `world.ts`, `itemBoxes.ts`, `useItem.ts`
  - `apps/game/src/powerups/items/shield.ts`, `items/boost.ts`
  - `apps/game/src/render/entityViews.ts` (item boxes now; entities in Task 12)
- Modify:
  - `game.ts` (owns `World` + `ItemBoxes`; per step: items → world.step after physics)
  - `kart/kart.ts` (boost reads `effects`)
  - `bots/bot.ts` (item decision)
  - `session.ts` (state item fields, `hit`/`itemGot` events)
  - `kartViews.ts` (shield bubble: translucent sphere while `shield` is active)
- Test: `apps/game/src/powerups/powerups.test.ts`

**Interfaces:**
- Produces:
```ts
// types.ts
export interface RollContext { position: number; racerCount: number }   // position is 1-based
export interface EntityLook { shape: 'sphere' | 'cone' | 'box'; color: string; size: number; y?: number; spin?: boolean }
export interface PowerupEntity { pos: Vec2; heading: number; look: EntityLook; hitRadius: number; dead: boolean;
  update(dt: number, world: WorldApi): void; onHitKart?(kart: Kart, world: WorldApi): void }
export interface WorldApi {
  karts: Kart[]; track: Track; time: number;
  spawnEntity(e: PowerupEntity): void;
  applyEffect(k: Kart, kind: string, seconds: number): void; hasEffect(k: Kart, kind: string): boolean; removeEffect(k: Kart, kind: string): void;
  hitKart(k: Kart): boolean;             // false if a shield absorbed it (shield removed, sfx 'shield_break'); true → spin = SPIN_TIME, speed *= 0.2, sfx 'kart_spinout', event hit
  kartAhead(k: Kart): Kart | null; kartBehind(k: Kart): Kart | null;   // by rankKarts order
  gapTo(a: Kart, b: Kart): number;       // b.distance − a.distance (metres along track)
  sfx(name: string): void;
}
export interface UseContext { kart: Kart; world: WorldApi }
export interface BotContext { kart: Kart; world: WorldApi; heldFor: number }
export interface PowerupDef { id: string; name: string; icon: string;
  weight(ctx: RollContext): number; use(ctx: UseContext): void; botShouldUse?(ctx: BotContext): boolean }
// registry.ts
export const POWERUPS: PowerupDef[];    // [shield, boost] now; mine, rocket appended in Task 12
export function getPowerup(id: string): PowerupDef | undefined;
// roll.ts
export function rollItem(ctx: RollContext, rand: () => number, defs?: PowerupDef[]): string;  // weighted pick
// world.ts
export interface World extends WorldApi { entities: PowerupEntity[];
  step(dt: number): void;                       // entity update, entity↔kart hits (dist < hitRadius + KART_RADIUS), drop dead, tick effects
  drainSfx(): string[]; drainHits(): number[] }  // kart ids hit since last drain
export function createWorld(karts: Kart[], track: Track): World;
// itemBoxes.ts
export class ItemBoxes { boxes: { pos: Vec2; respawn: number }[];  // respawn > 0 = hidden
  constructor(track: Track);
  update(dt: number, karts: Kart[], world: World, rand: () => number): number[];  // returns kart ids whose roll finished (→ itemGot)
}
// useItem.ts
export function handleItemInput(k: Kart, pressed: boolean, world: WorldApi): void;  // rising edge only; uses getPowerup(k.item).use; clears k.item
```
- **Item weights** (`p = (position − 1)/(racerCount − 1)`, 0 = leader, 1 = last; `p = 0` when `racerCount = 1`):
  - shield `3 − 2p`
  - boost `1 + 3p`
  - mine `3 − 2p`
  - rocket `0.5 + 3p`
- **Item boxes:**
  - Pickup radius is `1.5 + KART_RADIUS`.
  - A box gives `rolling = { left: 1, item: rollItem(...) }` only when `item === null && rolling === null`. The box hides either way and respawns after 3 s.
  - Each box plays sfx `item_box_pickup`.
- **Shield:** `use` → `applyEffect(kart, 'shield', 6)` + sfx `shield_up`. Bot: `heldFor > 5`, or any rocket entity targets this kart. (Expose `targetId` on rocket entities as an optional field `targetId?: number` on `PowerupEntity`; add that field to the interface.)
- **Boost:** `use` → `applyEffect(kart, 'boost', 1.5)` + sfx `boost`. Bot: `|wrapAngle(headingAt(s+20) − headingAt(s))| < 0.15` (a straight ahead).
- **Bots:** `botInput` gains an `item: boolean` result. It is true when `heldFor ≥ reaction + 1` and `(def.botShouldUse ?? (() => true))(ctx)`. To support this, `botInput` takes an optional `world?: WorldApi` and tracks `heldFor` in the brain.
- **Rendering:** item boxes render as pastel rainbow spinning rounded cubes, size 1.4, floating at y = 1.

- [ ] **Step 1: Write failing tests:**
```ts
test('rollItem favours shield/mine for leader and boost/rocket for last', () => {
  // count picks over 2000 seeded rolls (mulberry32) for position 1 vs 6 of 6
});
test('rollItem rand=0 picks first def with weight>0', () => {});
test('box gives a 1 s roll, then the item; ignored while holding', () => {});
test('box respawns after 3 s', () => {});
test('item press uses item once on rising edge and clears it', () => {});
test('shield absorbs one hit then is gone; expires after 6 s', () => {});
test('boost lasts 1.5 s and lets speed exceed MAX_SPEED', () => {});
test('hitKart without shield spins for 1.2 s and reports hit', () => {});
test('adding a new PowerupDef to the list needs no other change', () => {
  // rollItem with defs=[...POWERUPS, { id:'test', name:'T', icon:'🧪', weight:() => 1000, use: ({kart,world}) => world.applyEffect(kart,'test',1) }]
  // → rolls 'test'; handleItemInput with a temp registry override uses it
});
```
  - `getPowerup` looks up a mutable `POWERUPS` array, so a test can push a temporary def and remove it afterwards.

- [ ] **Step 2: Run the tests** (they should FAIL). **Step 3:** implement. **Step 4:** the tests should PASS, plus typecheck.

- [ ] **Step 5: Manual check.** Use Playwright with `/?keyboard=1&bots=5`: drive through a box, press Space after the roll, and take screenshots of the HUD row icon and the shield bubble/boost.

- [ ] **Step 6: Commit.** `git commit -m "feat(game): modular powerup system with shield and boost"`

---

### Task 12: Mine + rocket

**Files:**
- Create: `apps/game/src/powerups/items/mine.ts`, `apps/game/src/powerups/items/rocket.ts`
- Modify: `apps/game/src/powerups/registry.ts` (append both), `apps/game/src/render/entityViews.ts` (render `world.entities` by `look`)
- Test: `apps/game/src/powerups/items.test.ts`

**Interfaces:**
- Consumes: `PowerupDef`, `PowerupEntity`, `WorldApi` (Task 11).
- **Mine:**
  - `use` spawns an entity 2.5 m behind the kart (`pos − forward·2.5`).
  - Look: `{ shape: 'sphere', color: '#FF8A80', size: 0.9, y: 0.45 }`, `hitRadius: 0.8`.
  - Lifetime 30 s.
  - Ignores its owner for the first 0.5 s.
  - `onHitKart` → `world.hitKart(k)`, sfx `mine_explode`, `dead = true`.
  - On use, sfx `mine_drop`.
  - Bot: a kart behind within 15 m (`gapTo(kart, behind) > −15`).
- **Rocket:**
  - `use`: sfx `rocket_fire`. The target is `kartAhead(kart)`, and its `id` is stored in `targetId`.
  - It starts at the kart's `distance + 2` and travels 40 m/s along the racing line (`track.pointAt(d, lateral)`). The lateral lerps from the shooter's toward the target's over the flight.
  - When the gap to the target is < 10 m, it homes directly on the target's position.
  - It hits when within `hitRadius 1 + KART_RADIUS` of any non-owner kart (via `onHitKart`) → `hitKart` + sfx `rocket_explode`.
  - With no target, it flies straight along the shooter's heading. It dies when `|lateral| > width/2` (sfx `rocket_explode`) or after 3 s.
  - Overall max life is 6 s.
  - Look: `{ shape: 'cone', color: '#82B1FF', size: 1, y: 0.8 }`.
  - Bot: a kart ahead with `0 < gap < 60`.

- [ ] **Step 1: Write failing tests:**
```ts
test('mine drops 2.5 m behind and does not hit owner in first 0.5 s', () => {});
test('mine spins the first kart that touches it, then disappears', () => {});
test('mine expires after 30 s', () => {});
test('rocket hits the kart 30 m ahead within 2 s', () => {});
test('rocket blocked by target shield: target not spun, shield gone', () => {});
test('rocket with nobody ahead dies within 3 s', () => {});
test('bot uses rocket only with a kart ahead within 60 m; mine only with one behind within 15 m', () => {});
```

- [ ] **Step 2: Run the tests** (they should FAIL). **Step 3:** implement. **Step 4:** the tests should PASS, plus the full `npm test`.

- [ ] **Step 5: Manual check.** Use Playwright to take screenshots of a dropped mine and of a rocket in flight.

- [ ] **Step 6: Commit.** `git commit -m "feat(game): mine and rocket powerups"`

---

### Task 13: Audio placeholders + hooks + asset descriptions

**Files:**
- Create:
  - `apps/game/src/audio/manifest.ts`, `apps/game/src/audio/audio.ts`
  - `apps/game/scripts/make-silent-audio.sh`
  - `apps/game/public/audio/*.mp3`
  - `docs/audio-assets.md`
- Modify: `apps/game/src/main.ts` (wire events → sounds)
- Test: `apps/game/src/audio/manifest.test.ts`

**Interfaces:**
- Produces:
```ts
// manifest.ts
export const MUSIC = ['music_lobby', 'music_race'] as const;
export const SFX = ['countdown_beep', 'countdown_go', 'engine_loop', 'item_box_pickup', 'item_roulette', 'boost',
  'shield_up', 'shield_break', 'mine_drop', 'mine_explode', 'rocket_fire', 'rocket_explode', 'kart_spinout',
  'wall_bump', 'kart_bump', 'lap_complete', 'final_lap', 'race_finish', 'player_join'] as const;
export type SoundName = typeof MUSIC[number] | typeof SFX[number];
// audio.ts — Web Audio API, no Babylon audio
export interface Audio { load(): Promise<void>; play(name: SoundName): void; music(name: typeof MUSIC[number] | null): void;
  engine(speed01: number): void; unlock(): void }   // unlock() resumes AudioContext on first key/pointer
export function createAudio(baseUrl: string): Audio;  // per-file fetch/decode failures are logged once and that sound is silent
```
- **Wiring:**
  - Countdown 3/2/1 → `countdown_beep`, go → `countdown_go`.
  - `lap` → `lap_complete`; `finalLap` → `final_lap`; `finish` → `race_finish`.
  - `stepKart` `hitWall` → `wall_bump` (throttle to once per 0.3 s per kart).
  - Collision pairs → `kart_bump` (same throttle).
  - `world.drainSfx()` → play each.
  - Roll start → `item_roulette`.
  - Player join → `player_join`.
  - Lobby/results → `music_lobby`; racing → `music_race`.
  - `engine_loop` loops while racing, with `playbackRate = 0.8 + 0.6·avgSpeed/MAX_SPEED` across all karts.
  - Sound names come only from the manifest, which the type enforces. Powerup files call `world.sfx(name: string)`; at runtime, `Audio.play` ignores unknown names.

- [ ] **Step 1: Write a failing test** that `manifest.test.ts` checks every `MUSIC`/`SFX` name has a file in `apps/game/public/audio/` (use `fs.existsSync` relative to `import.meta.url`), and that no extra mp3s exist.

- [ ] **Step 2: Run the test** (it should FAIL). **Step 3: Write `make-silent-audio.sh`.**
  - For each name: `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t <dur> -q:a 9 apps/game/public/audio/<name>.mp3`.
  - Durations: music 2 s, `engine_loop` 1 s, everything else 0.3 s.
  - Run it.

- [ ] **Step 4: Run the test** (it should PASS).

- [ ] **Step 5: Implement `audio.ts` and wire `main.ts`.**
  - Verify with Playwright that `/?keyboard=1` has no console errors after Enter (the files decode).
  - Temporarily rename one file and confirm the game still runs with a single logged warning, then restore it.

- [ ] **Step 6: Write `docs/audio-assets.md`.**
  - One `##` section per sound: file, type (loop/one-shot), target duration, mood, and a **generation prompt**.
  - Music prompts: "cozy upbeat chiptune / ukulele + glockenspiel lobby loop, 100 BPM, seamless 30–60 s loop, warm and friendly" and "bouncy driving race loop, 140 BPM, playful synth bass, bright plucks, seamless 60–90 s loop".
  - SFX: soft, rounded, toy-like, nothing harsh.
  - Engine: a gentle toy-motor hum, seamless 1–2 s loop at a neutral pitch, because pitch is shifted in code.
  - Final note: replace a file with the same name; mono 44.1 kHz mp3 is fine.

- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(game): audio system with silent placeholders and asset descriptions"`

---

### Task 14: TV build verification + final polish pass

**Files:**
- Modify: whatever the checks below reveal. `README.md` (new): a one-screen quickstart (dev, test, build:tv, controller URL, docs links).

- [ ] **Step 1:** Run `npm test && npm run typecheck && npm run build -w game && npm run build -w controller`. All must pass.

- [ ] **Step 2: Check the TV bundle for syntax newer than Chrome 85.**
  - `grep -E '\?\?=|\|\|=|&&=|#[a-zA-Z_]+ in |static \{' apps/game/dist/assets/*.js` should match nothing, or only matches inside strings.
  - Otherwise fix the build target config.

- [ ] **Step 3: Couch-readability pass.** Use Playwright at 1920×1080 to take screenshots of the lobby, countdown, mid-race and results.
  - Check the TV text is at least 36 px, at most ~6 words per panel, and every player row is coloured.
  - Check the controller at 844×390 (landscape phone): the buttons fill the screen and the labels are big.
  - Fix any issues.

- [ ] **Step 4: Write `README.md`.** Push, then open a draft PR to `main`. If `main` doesn't exist, ask the user to create it from this branch.

- [ ] **Step 5: USER CHECKPOINT.** Ask the user to sideload the new `.wgt` and play one full race with phones plus bots. Collect feedback for a follow-up round.
