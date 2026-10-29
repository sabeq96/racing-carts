# 🏎️ Racing Carts

A cozy couch kart game. The **TV** (a Samsung Tizen TV, or any browser) runs the race and hosts the room;
**phones** are tilt controllers that join with a 4-letter room code. Up to 6 karts, bots fill the empty slots, 3 laps.

## Play

1. Open Racing Carts on the TV. It shows a room code and a QR code.
2. Each player scans the QR (or opens `https://sabeq96.github.io/racing-carts/controller/?address=CODE`), types a name and taps **Tap to start** (allow motion access if the phone asks).
3. The first phone to join is the host and taps **Start race**.
4. Hold the phone sideways and **tilt to steer**. Hold **GAS**, tap **ITEM** to use what you picked up, hold **BRAKE** to slow down or reverse. **Center** resets "straight ahead".
5. After 3 laps, the host taps **Rematch**.

## Develop

```bash
npm install
npm test
npm run typecheck
```

```bash
npm run dev -w game          # open the printed URL with ?keyboard=1&bots=5, press Enter to race
npm run dev -w controller    # the phone page, at /racing-carts/controller/ (add ?demo=1, ?demo=lobby or ?demo=results to preview)
```

TV URL flags:

| Flag | What it does |
| --- | --- |
| `?keyboard=1` | Adds you as a player: arrows/WASD drive, Space uses the item, Enter starts or rematches |
| `?bots=N` | At most N bots (default: fill every free slot) |
| `?aa=1` / `?aa=0` | Forces antialiasing on / off (default: off on the TV, on elsewhere) |
| `?probe=1` | Connectivity probe instead of the game: one dot per phone |
| `?give=rocket` | Dev only, with `?keyboard=1`: your kart gets that item at GO (`shield`, `boost`, `mine`, `rocket`) |

The packaged TV app has no address bar. To use a flag on the TV, put it in `apps/game/public/config.xml`
(for example `<content src="index.html?probe=1"/>`), then rebuild and reinstall. See
[docs/tizen-sideload.md](docs/tizen-sideload.md#url-flags-on-the-tv).

## Ship it

**TV:** build and sign the `.wgt`, then install it. All steps are in [docs/tizen-sideload.md](docs/tizen-sideload.md).

```bash
npm run build:tv    # apps/game/dist/RacingCarts.wgt
tizen install -n apps/game/dist/RacingCarts.wgt -t <device-name>
```

**Phones (GitHub Pages), one time:** in GitHub open **Settings → Pages** and set **Source** to **GitHub Actions**.
Free GitHub Pages needs a **public** repository (Pages from a private repository needs a paid plan).
Then create `main` from this branch and push it:

```bash
git checkout -b main && git push -u origin main
```

Every push or merge to `main` deploys the game and the controller (watch the **Actions** tab; it can also be run by hand there).
Then check that `https://sabeq96.github.io/racing-carts/controller/?address=TEST` opens the join screen.

## First couch test

1. Sideload the new `.wgt` and open it.
2. Join with **one** phone first. If it never gets in, stop and see
   "Phones can't connect (WebRTC)" in [docs/tizen-sideload.md](docs/tizen-sideload.md#phones-cant-connect-webrtc).
3. Join with the other phones and let bots fill the rest. Play one full race and a rematch.
4. Check:
   - the emoji icons (items 🛡️ ⚡ 💣 🚀, 🎲, 🏁) render on the TV, not as empty boxes;
   - no screen saver kicks in during a 20-minute session;
   - a late friend can join after race 1 (scan the join card on the results screen) and drives in the next race.
5. Note: did every phone join, does tilt steering feel right, can you read the TV from the couch, is anything laggy,
   and are the bots too easy or too hard. The sounds are silent placeholders for now.

## More docs

- [docs/powerups.md](docs/powerups.md): how to add a powerup (one file per item)
- [docs/audio-assets.md](docs/audio-assets.md): prompts for generating the sounds and music
- [docs/tizen-sideload.md](docs/tizen-sideload.md): Tizen Studio, certificates, install and debugging

## Layout

```
apps/game/         TV game: Babylon.js scene, race, bots, powerups, audio, PeerJS host
apps/controller/   phone controller (GitHub Pages)
packages/shared/   protocol, room codes, kart colours
docs/              sideloading, powerups, audio
```
