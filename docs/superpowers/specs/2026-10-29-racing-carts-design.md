# Racing Carts — Design Spec

Date: 2026-10-29
Status: Draft for review

## 1. Intent

A couch kart-racing game for a 2022 Samsung OLED TV (Tizen 6.5). The TV runs and displays the game; phones are simple tilt controllers. "Mario Kart, but way simpler." For local fun only — sideloaded in Developer Mode, never published.

**Success for the MVP:** friends scan a QR code on the TV, get a coloured kart, and race 3 laps on one track against each other and bots (6 racers total), using items, with no laptop needed during play.

### Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Networking | WebRTC via PeerJS public broker; `?address=` carries a room code, not an IP |
| Engine | Babylon.js + TypeScript + Vite (not Phaser: Phaser is 2D only) |
| Controller input | Tilt-to-steer + on-screen buttons |
| Players | Up to 6 karts; bots fill empty slots |
| Camera | One shared camera that zooms to fit all human karts, up to whole-track view. **No catch-up respawn.** |
| Items | One held item per player; modular powerup registry |
| Audio | Silent placeholder mp3s + written descriptions for later generation |

### Guiding principles: small, simple, cozy, intuitive

These apply to every decision below. When in doubt, cut a feature rather than add one.

- **Cozy look.**
  - Soft pastel and warm palette, warm sunny light with a gentle sky gradient.
  - Chunky rounded low-poly shapes: toy-like karts and lollipop trees.
  - Nothing gritty, dark, or realistic.
- **Readable from the couch.**
  - Big type and few words on the TV.
  - Colour is the main identifier: each player's kart colour also tints their phone, name tag and HUD row.
- **Intuitive in seconds.**
  - Scan, tap, tilt, go. No menus, no settings screens, no tutorial needed.
  - The phone shows only what a player needs right now.
- **Forgiving and friendly.**
  - Soft wall bounces, short spin-outs, no elimination.
  - Bots are relaxed rather than ruthless, so newcomers have fun.
- **Small codebase.**
  - Few files, plain code, no speculative abstractions beyond the powerup registry.

### Out of scope (MVP)

Multiple tracks, kart selection beyond colour, online play, split-screen, persistent stats, TV-remote menus, 3D model files (all meshes generated in code).

## 2. Constraints

- **The TV cannot be a server.** Tizen web apps cannot listen on sockets, so phones cannot connect directly to a TV address.
- **HTTPS rule.** The controller is served over HTTPS from GitHub Pages and cannot open a `ws://` connection to a LAN IP. WebRTC data channels avoid this.
- **Older browser engine.** The TV browser is roughly Chromium 85, so builds target `chrome85` and the GPU budget is modest: low poly, no real-time shadows, no post-processing, instanced karts.
- **Internet only for the handshake.** PeerJS signalling needs internet; gameplay traffic then flows peer-to-peer over the LAN.
- **Unverified risk.** WebRTC data channel support on Tizen 6.5 has not been confirmed. Milestone 1 tests it on the real TV before anything else is built. Fallback: relay messages through a free WebSocket relay over `wss://`.

## 3. Repository layout

npm workspaces monorepo:

```
racing-carts/
├─ apps/game/          Babylon.js game → Tizen .wgt (also runs in desktop browser)
├─ apps/controller/    Vanilla TS phone controller → GitHub Pages
├─ packages/shared/    Protocol message types, constants, encode/decode
└─ docs/               Specs, plans, tizen-sideload.md, audio-assets.md
```

## 4. Networking

- **Room code.** The TV generates a 4-letter room code from an alphabet without ambiguous letters, e.g. `KART`, and opens a PeerJS peer with ID `racingcarts-<CODE>`. If that ID is taken, it picks a new code.
- **Joining.** The lobby shows a QR code and the URL `https://sabeq96.github.io/racing-carts/?address=<CODE>`. If `address` is missing, the controller asks for the code to be typed.
- **Authority.** The TV is authoritative for all simulation. Phones send input and render what the TV tells them.
- **Messages.** All defined in `packages/shared`, sent as JSON with a `t` field naming the type:
  - Phone → TV:
    - `hello {token, name}`
    - `input {steer: -1..1, gas: bool, brake: bool, item: bool}` at about 30 Hz
    - `start` (host only)
    - `rematch` (host only)
  - TV → phone:
    - `welcome {playerId, slot, color, isHost}`
    - `state {phase, position, lap, totalLaps, item}`, sent when a value changes
    - `event {kind: 'hit' | 'itemGot' | 'finish', …}`
    - `lobbyFull`
- **Reconnects.** Each phone keeps a random token in `localStorage`. A `hello` with a known token gets the same slot back. While a phone is disconnected, a bot drives its kart. When the host leaves, the next human player becomes host.
- **Same input for everyone.** Keyboard input on desktop and bots produce the same per-kart `InputSnapshot` as phones, so the race code never knows who is driving.

## 5. Game structure (`apps/game/src`)

| Module | Responsibility |
|---|---|
| `net/` | PeerJS host, connection registry, message → `InputSnapshot` per kart |
| `race/` | State machine Lobby → Countdown (3-2-1-GO) → Racing → Results → Lobby; lap and checkpoint counting; race positions; 3 laps |
| `kart/` | Arcade physics at a fixed 60 Hz step: acceleration, top speed, steering, grip with a little drift, slowdown on grass, wall bounce, kart-to-kart bumps, spin-out state. No physics engine. |
| `track/` | Track defined as data: closed centre-line spline plus width. Generates the road mesh, walls, checkpoints, item-box spots, start grid, racing line, and scenery (trees and rocks from shared low-poly materials). Flat ground, walls everywhere. |
| `bots/` | Follow a point ahead on the racing line, with random lane offsets and a per-bot skill (top-speed factor and reaction delay). Use items through each powerup's `botShouldUse`. |
| `powerups/` | Modular item system (section 6) |
| `render/` | Babylon scene and lights; instanced kart mesh coloured per player; shared fit-all camera; HTML overlay for lobby, QR code, position list and results |
| `audio/` | Manifest-driven `sfx.play(name)` and `music.play(name)` |
| `loop.ts` | Each fixed step: inputs → kart physics → powerups and entities → race rules. Render once per frame. |

**Track v1:** one closed loop with a long straight, a hairpin, and an S-bend, about 25–35 seconds per lap. There are 2 rows of item boxes, and each box respawns 3 seconds after pickup.

**Camera:** chase angle from above and behind. Each frame it fits a bounding box around all **human** karts, falls back to all karts when there are no humans, and smoothly zooms between a minimum distance and a whole-track maximum. There is no respawn.

**Kart colours:** soft but distinct coral, sky blue, mint, butter yellow, lavender, peach, assigned by slot. They must stay distinguishable at a glance from the couch.

**Visual style:** warm hemispheric light plus one sun directional light; flat-shaded pastel materials; a blob shadow under each kart instead of real shadows; rounded HUD panels with large type.

## 6. Powerups (modular)

Adding an item means one file in `powerups/items/` plus one line in `powerups/registry.ts`.

```ts
interface PowerupDef {
  id: string;
  name: string;
  icon: string;                              // emoji, shown on phone + HUD
  weight(ctx: RollContext): number;          // RollContext has position, racerCount
  use(ctx: UseContext): void;
  botShouldUse?(ctx: BotContext): boolean;   // default: use immediately
}

interface PowerupEntity {
  update(dt: number, world: WorldApi): void;
  onHitKart?(kart: Kart, world: WorldApi): void;
  dead: boolean;
}
```

The `WorldApi` exposed to powerups is the only way items affect the game:
- `spawnEntity`, `spawnMesh(name)`
- `applyEffect(kart, effect)`: timed effects such as `speedBoost` and `shield`
- `hitKart(kart)`: spin-out; a shield absorbs it
- `kartAhead(kart)`, `kartBehind(kart)`, `racingLine`
- `sfx.play`

**Item rules**
- Each kart holds one item.
- Driving through a box while holding an item gives nothing.
- An item roll is weighted by position.
- Pickup plays a roulette of about 1 second, then the item is set.

| Item | Behaviour | Bot uses when |
|---|---|---|
| 🛡️ Shield | Absorbs the next hit or lasts 6 s, whichever comes first; bubble mesh | A rocket targets it, or holding it for more than 5 s |
| ⚡ Boost | +60% top speed for 1.5 s; exhaust flame | Immediately on a straight |
| 💣 Mine | Dropped behind the kart. The first kart to touch it spins out for 1.2 s. Lasts 30 s. | A kart is within 15 m behind |
| 🚀 Rocket | Follows the racing line and homes in on the next kart ahead, causing a spin-out. With no kart ahead it flies straight and breaks on walls. | A kart is ahead within 60 m |

Weights favour boosts and rockets for players further back, and shields and mines for the leader.

## 7. Controller (`apps/controller`)

1. **Start screen.** Read `?address`, or show a code input. Then a name input and a **Tap to start** button. The tap calls `DeviceOrientationEvent.requestPermission()` on iOS, saves the current tilt as neutral, requests a wake lock and connects.
2. **Driving screen** (landscape, background in the kart colour):
   - left half: **ITEM** button with the item icon
   - right half: **GAS**
   - small **BRAKE/REVERSE** button
   - tilt meter at the top
   - "3rd · Lap 2/3" status
3. **Tilt steering.** Steer is taken from the axis that matches the screen orientation, with a ±3° dead-zone and full lock at ±30°.
4. **Host-only buttons.** **Start race** in the lobby and **Rematch** on the results screen.
5. **Vibration.** `navigator.vibrate` on hit, where the phone supports it (not iOS).
6. **Disconnects.** The page shows "Reconnecting…" and retries automatically with the same token.

## 8. Audio

Silent placeholder mp3s in `apps/game/public/audio/`. Every file is described in `docs/audio-assets.md`: purpose, duration, loop or one-shot, mood, and a ready-to-use generation prompt.

- **Music:** `music_lobby`, `music_race`
- **Effects:** `countdown_beep`, `countdown_go`, `engine_loop`, `item_box_pickup`, `item_roulette`, `boost`, `shield_up`, `shield_break`, `mine_drop`, `mine_explode`, `rocket_fire`, `rocket_explode`, `kart_spinout`, `wall_bump`, `kart_bump`, `lap_complete`, `final_lap`, `race_finish`, `player_join`

A single engine loop plays on the TV, with pitch following the average kart speed.

## 9. Build and deploy

- **`npm run dev -w game`** runs on desktop. The keyboard controls kart 0, and `?bots=N` sets the number of bots.
- **`npm run build:tv -w game`** runs a Vite build with target `chrome85`, then packages a `.wgt` with Tizen `config.xml` using the Tizen CLI on the user's machine.
- **`npm run dev -w controller`** runs the controller locally. It can use a local PeerJS ID for testing.
- **GitHub Actions** builds `apps/controller` and deploys it to GitHub Pages on push to `main`.
- **`docs/tizen-sideload.md`** covers:
  - TV Developer Mode
  - Tizen Studio or CLI
  - the Samsung certificate
  - `sdb connect` and `tizen install`

## 10. Error handling

- **Broker unreachable.** The TV shows "No internet — can't create room" and retries every 5 s.
- **Phone fails to connect.** The controller shows the error and a retry button. Common causes are a wrong code or the TV app not running.
- **Phone disconnects mid-race.** A bot takes over the kart. The phone reconnects with the same token and gets its kart back.
- **Seventh phone joins.** It receives `lobbyFull`.
- **Motion permission denied.** The controller falls back to on-screen ◀ ▶ buttons.

## 11. Testing

Vitest unit tests for the pure-logic modules:
- kart physics step
- lap, checkpoint and position calculation
- powerup weighting and effects (a shield blocks a hit; a mine hits the first kart)
- bot item decisions
- protocol encode and decode
- the race state machine

Rendering, networking, and controller UX are verified by hand: first on desktop with keyboard and bots, then on the TV with real phones.

## 12. Milestones

1. **Connectivity test on the TV.** A minimal `.wgt` plus controller: the phone tilts and a dot moves. This confirms WebRTC on Tizen 6.5.
2. Track generation, kart physics and the camera, driven by keyboard on desktop.
3. Phones as controllers: lobby, QR code, slots, reconnects.
4. Race flow (countdown, laps, results) and bots.
5. Powerup system and the four items.
6. Audio hooks, placeholder files, audio-assets doc, sideload doc, Pages deploy.
