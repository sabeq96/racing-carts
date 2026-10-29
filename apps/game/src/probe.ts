import QRCode from 'qrcode';
import { KART_COLORS, controllerUrl, type InputSnapshot, type Phase, type ServerMsg } from '@rc/shared';
import { startHost, type NetHost } from './net/host';
import { PlayerRegistry } from './net/players';

const RETRY_MS = 5000;
const PULSE_MS = 450;
const TOTAL_LAPS = 3;
const ARENA_LEFT = 0.4; // fraction of the canvas width where the dot arena starts
const STEER_RANGE = 0.4; // dots move +-40% of the arena width
const GAS_RANGE = 0.55; // fraction of the canvas height a full gas lifts a dot

interface Dot {
  steer: number;
  gas: boolean;
  brake: boolean;
  item: boolean;
  x: number; // eased, -1..1
  lift: number; // eased, 0..1
  pulseAt: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  style = '',
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  if (style) node.style.cssText = style;
  return node;
};

/** Connectivity probe: opens a room, shows code + QR, and draws a dot per phone that moves with its input. */
export function runProbe(hud: HTMLElement): void {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');

  // ----- HUD layout -----
  hud.textContent = '';
  const panel = el(
    'div',
    {},
    'position:absolute;left:48px;top:48px;bottom:48px;width:740px;box-sizing:border-box;padding:36px 44px;' +
      'background:#fffaf2;border-radius:48px;box-shadow:0 12px 0 #f0dcc4;display:flex;flex-direction:column;align-items:center;',
  );
  const title = el('div', { textContent: 'Racing Carts' }, 'font-size:56px;font-weight:900;color:#ff8a80;');
  const label = el('div', { textContent: 'Room code' }, 'font-size:36px;color:#8a7466;margin-top:8px;');
  const codeEl = el(
    'div',
    { textContent: '····' },
    'font-size:160px;line-height:1.05;font-weight:900;letter-spacing:0.12em;padding-left:0.12em;color:#5b4638;',
  );
  const qrEl = el(
    'img',
    { alt: 'QR code to join' },
    'image-rendering:pixelated;border-radius:24px;margin-top:12px;background:#fff;display:none;',
  );
  const urlEl = el('div', {}, 'font-size:26px;color:#8a7466;margin-top:16px;text-align:center;word-break:break-all;');
  const statusEl = el('div', {}, 'font-size:40px;font-weight:900;color:#5b4638;margin-top:auto;text-align:center;');
  panel.append(title, label, codeEl, qrEl, urlEl, statusEl);
  hud.append(panel);

  const setStatus = (text: string, color = '#5b4638'): void => {
    statusEl.textContent = text;
    statusEl.style.color = color;
  };
  setStatus('Opening room…', '#8a7466');

  // ----- canvas sizing -----
  let cw = 1920;
  let ch = 1080;
  const resize = (): void => {
    cw = window.innerWidth;
    ch = window.innerHeight;
    canvas.width = cw;
    canvas.height = ch;
  };
  resize();
  window.addEventListener('resize', resize);

  // ----- game-ish state -----
  const registry = new PlayerRegistry();
  const dots = new Map<string, Dot>();
  let phase: Phase = 'lobby';
  let host: NetHost | null = null;

  const stateFor = (token: string): ServerMsg => ({
    t: 'state',
    phase,
    isHost: registry.hostToken() === token,
    position: 0,
    racers: registry.all().length,
    lap: 1,
    totalLaps: TOTAL_LAPS,
    item: null,
    itemIcon: null,
    rolling: false,
  });

  const broadcast = (): void => {
    if (!host) return;
    for (const p of registry.all()) if (p.connected) host.send(p.token, stateFor(p.token));
  };

  const refreshStatus = (): void => {
    const n = registry.all().filter((p) => p.connected).length;
    if (n === 0) setStatus('Scan the code with your phone', '#8a7466');
    else setStatus(`${n} ${n === 1 ? 'player' : 'players'} connected`, '#1f5a41');
  };

  // ----- host -----
  const open = (): void => {
    startHost({
      onHello(token, name) {
        registry.purgeExpired(performance.now());
        const res = registry.join(token, name, phase);
        if (res === 'full') return { t: 'lobbyFull' };
        if (!dots.has(token)) {
          dots.set(token, { steer: 0, gas: false, brake: false, item: false, x: 0, lift: 0, pulseAt: -Infinity });
        }
        host?.send(token, { t: 'welcome', slot: res.slot, color: KART_COLORS[res.slot] });
        broadcast();
        refreshStatus();
        return null;
      },
      onMessage(token, msg) {
        if (msg.t === 'input') {
          const d = dots.get(token);
          if (!d) return;
          const snap: InputSnapshot = msg;
          if (snap.item && !d.item) d.pulseAt = performance.now();
          d.steer = snap.steer;
          d.gas = snap.gas;
          d.brake = snap.brake;
          d.item = snap.item;
        } else if (msg.t === 'start') {
          if (phase === 'lobby' && registry.hostToken() === token) {
            phase = 'racing';
            broadcast();
          }
        }
      },
      onDisconnect(token) {
        registry.disconnect(token, phase, performance.now());
        if (phase === 'lobby') dots.delete(token);
        broadcast();
        refreshStatus();
      },
    }).then(
      (h) => {
        host = h;
        codeEl.textContent = h.code;
        codeEl.style.color = '#5b4638';
        const url = controllerUrl(h.code);
        urlEl.textContent = url.replace(/^https:\/\//, '');
        QRCode.toDataURL(url, { width: 360, margin: 1 }).then(
          (data) => {
            // The library rounds to whole pixels per module; show the image at exactly its own size
            // so the TV never rescales it by a fractional factor.
            qrEl.onload = () => {
              qrEl.style.width = `${qrEl.naturalWidth}px`;
              qrEl.style.height = `${qrEl.naturalHeight}px`;
              qrEl.style.display = 'block';
            };
            qrEl.src = data;
          },
          () => {
            qrEl.style.display = 'none';
          },
        );
        refreshStatus();
      },
      (err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        codeEl.textContent = '····';
        qrEl.style.display = 'none';
        urlEl.textContent = '';
        setStatus(
          reason === 'broker-unreachable' ? "No internet — can't create room" : `Can't create room (${reason})`,
          '#c0392b',
        );
        window.setTimeout(open, RETRY_MS);
      },
    );
  };
  open();

  // ----- draw loop -----
  const frame = (now: number): void => {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#fff3e4';
    ctx.fillRect(0, 0, cw, ch);

    const arenaX = cw * ARENA_LEFT;
    const arenaW = cw - arenaX;
    const cx = arenaX + arenaW / 2;
    const baseY = ch - 140;

    // arena floor
    ctx.fillStyle = '#ffe9cf';
    ctx.fillRect(arenaX, 0, arenaW, ch);

    for (const p of registry.all()) {
      const d = dots.get(p.token);
      if (!d || !p.connected) continue;
      d.x += (d.steer - d.x) * 0.35;
      d.lift += ((d.gas ? 1 : 0) - d.lift) * 0.12;
      const x = Math.min(cw - 70, Math.max(arenaX + 70, cx + (p.slot - 2.5) * 70 + d.x * STEER_RANGE * arenaW));
      const y = baseY - d.lift * GAS_RANGE * ch + (d.brake ? 40 : 0);
      const t = (now - d.pulseAt) / PULSE_MS;
      const pulse = t >= 0 && t < 1 ? Math.sin(t * Math.PI) : 0;
      const r = 48 + pulse * 40;

      ctx.fillStyle = 'rgba(91,70,56,0.12)';
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.9, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = KART_COLORS[p.slot];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#5b4638';
      ctx.font = '900 34px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, x, y + r + 52);
    }

    if (phase === 'racing') {
      ctx.fillStyle = '#8a7466';
      ctx.font = '900 34px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Phones driving: tilt, gas and item move the dots', cx, 70);
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}
