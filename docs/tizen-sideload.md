# Sideloading Racing Carts onto a Samsung TV (Tizen)

Written for someone who has never used Tizen. Target: a 2022 Samsung TV (Tizen 6.5). Do the steps in order.

## 1. Install Tizen Studio

1. Download Tizen Studio (or the CLI-only "Tizen Studio with Command-line Tools") from the Tizen developer site and install it.
2. Open **Package Manager** (Tizen Studio: Tools > Package Manager, or `package-manager` in the CLI install).
3. Under **Extension SDK**, install **TV Extensions-6.5** (or the closest TV extension available) and **Samsung Certificate Extension**.
4. Put `~/tizen-studio/tools/ide/bin` (it contains `tizen`) and `~/tizen-studio/tools` (it contains `sdb`) on your `PATH`.

## 2. Turn on Developer Mode on the TV

1. On the TV open **Apps**, then type `12345` with the on-screen number pad.
2. Switch **Developer mode** to **On**.
3. In **Host PC IP** enter the IP address of the computer you will build on (the TV and the PC must be on the same network).
4. Click OK and **reboot the TV** (hold power until it restarts).
5. After the reboot, Apps shows "Develop mode" in the top corner. Note the TV's IP address (Settings > General > Network > Network Status).

## 3. Create a Samsung certificate profile

1. Connect to the TV first (step 4), so Tizen Studio can read its DUID.
2. Open **Tools > Certificate Manager** and click **+**.
3. Choose **Samsung** (not "Tizen"), device type **TV**, and sign in with a Samsung account.
4. Name the profile **`RacingCarts`**. This name is what `npm run build:tv` uses by default.
5. On the device step, tick your TV (its **DUID** is listed once `sdb` is connected) so the certificate is allowed to install on it.
6. Finish the wizard.

## 4. Connect to the TV

```bash
sdb connect <TV_IP>
sdb devices
```

`sdb devices` should list the TV with state `device`. Note the name in the second column (for example `UE55AU8000`); that is `<device-name>` below.

## 5. Build and package

```bash
npm install
npm run build:tv
```

This builds the game (`apps/game/dist`) and signs it into `apps/game/dist/RacingCarts.wgt`. To use a different certificate profile: `bash apps/game/scripts/package-tizen.sh MyProfile`.

## 6. Install on the TV

```bash
tizen install -n apps/game/dist/RacingCarts.wgt -t <device-name>
```

## 7. Run and debug

```bash
tizen run -p RcCarts001.RacingCarts -t <device-name>
```

To use Chrome DevTools, start the app in debug mode; the TV prints a debug port, which you forward to your PC:

```bash
sdb -s <device-name> shell 0 debug RcCarts001.RacingCarts     # prints "... port: 34000"
sdb -s <device-name> forward tcp:9222 tcp:<port-from-previous-command>
```

Then open `chrome://inspect` (or `http://localhost:9222`) in desktop Chrome and inspect the app.

## 8. Troubleshooting

- **Install fails with a certificate error:** the certificate must include this TV's DUID. Recreate the profile with the TV connected. If an older build is installed with a different certificate, uninstall it first (`tizen uninstall -p RcCarts001.RacingCarts -t <device-name>`), then install again.
- **`sdb connect` fails or the TV is listed as `offline`:** the Host PC IP typed in Developer mode must be the IP of the computer you are running `sdb` on. If your PC's IP changed, update it on the TV and reboot the TV.
- **`tizen: command not found`:** add Tizen Studio's `tools/ide/bin` to your `PATH` (step 1).
- **Black screen on launch:** connect DevTools as in step 7 and check the console for errors (the game ships as a single classic script, so a script load error or a JavaScript syntax error is the usual cause).

## First test: connectivity probe

Until the real game lands, the app starts in a **connectivity probe**. It exists to prove that phones can reach the TV over WebRTC (PeerJS) before anything else is built. It is the same screen as opening `index.html?probe=1`.

1. Complete steps 1 to 6 above and start the app on the TV.
2. The TV shows a big 4-letter **room code**, a **QR code** and the controller address. If it shows "No internet — can't create room", the TV cannot reach the PeerJS broker (`0.peerjs.com`); check the TV's network and that it retries every 5 seconds.
3. Scan the QR code with **two phones** (any browser; they do not need to be on the TV's Wi-Fi network, but being on it helps).
4. Each phone enters a name and taps **Tap to start**. A coloured dot per phone appears on the TV and the TV text says "2 players connected".
5. On the first phone (the host) tap **Start race**. Both phones switch to the drive screen.
6. Tilt the phones and hold **GAS** and **ITEM**: each phone's dot should move left/right with the tilt, rise while gas is held, and pulse when ITEM is tapped. Both dots must move.
7. Result to report: did the room open, did both phones connect, did both dots move, and was it smooth?

If the room opens but phones never connect, WebRTC does not work on the TV or network; that decides whether we need a `wss://` relay instead of PeerJS.

## Deploying the phone controller (GitHub Pages)

The controller is deployed by `.github/workflows/deploy-controller.yml` on every push to `main` (or by hand from the Actions tab). One-time setup in the GitHub repository:

1. Make sure a `main` branch exists with this code.
2. Go to **Settings > Pages** and set **Source** to **GitHub Actions**.
3. After the first run, the controller is live at `https://sabeq96.github.io/racing-carts/`, which is the address the QR code points to.
