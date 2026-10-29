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

This builds the game (`apps/game/dist`) and signs it into `apps/game/dist/RacingCarts.wgt`. To use a different certificate profile: `bash scripts/build-tv.sh MyProfile`.

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
- **No sound on the TV:** the game tries to start its audio at launch, and again on every phase change and whenever a phone joins, but a TV can keep audio locked until a button is pressed. Press any key on the TV remote once. Also check the TV volume and sound output (not muted, the right speakers selected, no Bluetooth device taking the sound). Note that the audio files are **silent placeholders** until you replace them with real recordings (see `docs/audio-assets.md`), so a working game with no sound is expected until then.

## First couch test

Start the app on the TV and follow "First couch test" in the [README](../README.md): join with **one** phone first, then the rest, and play one full race plus a rematch.

## URL flags on the TV

In a browser the game takes flags in the address (`?probe=1`, `?aa=0`, `?bots=3`, … listed in the README). The packaged TV app has no address bar, so the flags go into the start page in `apps/game/public/config.xml`:

```xml
<content src="index.html?probe=1"/>
```

Then rebuild and reinstall (steps 5 and 6). Change it back to `index.html` afterwards.

This has not been checked on a real TV yet: Tizen's docs only show a plain file name in `content src`, so **try** it. If the app then fails to start or ignores the flag, put `index.html` back and use the fallback below (a desktop browser on the same Wi-Fi). Antialiasing needs no flag on the TV: it is off by default there.

## Connectivity probe

The probe replaces the game with a bare connection test: it opens a room and draws one dot per phone that moves with the phone's tilt, gas and item. It shows whether phones can reach **the device it runs on** over WebRTC (PeerJS).

- **On the TV** (tests the TV itself): enable it with `content src="index.html?probe=1"` as above.
- **Fallback, in a desktop browser on the same Wi-Fi** (`npm run dev -w game`, then add `?probe=1` to the URL): this tests the broker, the phones and the network, **not** the TV. If it works on the laptop but phones cannot join the TV, the problem is on the TV side (see below).

1. Open the probe.
2. It shows a big 4-letter **room code**, a **QR code** and the controller address. If it shows "No internet — can't create room", that device cannot reach the PeerJS broker (`0.peerjs.com`); check its network. It retries every 5 seconds.
3. Scan the QR code with **two phones** (any browser; they do not need to be on the same Wi-Fi, but being on it helps).
4. Each phone enters a name and taps **Tap to start**. A coloured dot per phone appears and the text says "2 players connected".
5. On the first phone (the host) tap **Start race**. Both phones switch to the drive screen.
6. Tilt the phones and hold **GAS** and **ITEM**: each phone's dot should move left/right with the tilt, rise while gas is held, and pulse when ITEM is tapped. Both dots must move.
7. Result to report: which device ran the probe, did the room open, did both phones connect, did both dots move, and was it smooth?

## Phones can't connect (WebRTC)

WebRTC on the TV is the biggest untested part. Symptoms: the TV shows a room code, but a phone stays on "Joining…" and after 15 s says "Can't find room".

Why it can happen: PeerJS uses webrtc-adapter, which guesses the browser from the user agent. The Samsung TV's user agent (`SMART-TV; Tizen …`) may confuse that detection, so PeerJS may treat the TV as an unsupported browser or use the wrong WebRTC quirks.

What to do:

1. Run the probe **on the TV** (`content src="index.html?probe=1"`, see "URL flags on the TV"), then rebuild and reinstall.
2. Attach DevTools as in step 7 and open the **Console**.
3. Join with one phone and note every error or warning (look for `peerjs`, `webrtc`, `RTCPeerConnection`, "browser not supported" or ICE errors).
4. Also run the probe in a desktop browser on the same Wi-Fi: if that works, the network and broker are fine and the problem is the TV.

The fix may need PeerJS's adapter to be told the browser details (Chrome, version 85) instead of guessing from the user agent. That is a code change for a later session; bring the console logs from step 3.

## Deploying the phone controller (GitHub Pages)

The controller is deployed by `.github/workflows/deploy-controller.yml` on every push to `main` (or by hand from the Actions tab). One-time setup in the GitHub repository:

Free GitHub Pages needs a **public** repository; Pages from a private repository needs a paid GitHub plan.

1. Make sure a `main` branch exists with this code.
2. Go to **Settings > Pages** and set **Source** to **GitHub Actions**.
3. After the first run, the controller is live at `https://sabeq96.github.io/racing-carts/`, which is the address the QR code points to.
