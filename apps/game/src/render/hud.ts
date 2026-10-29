import { TOTAL_LAPS } from '@rc/shared';

const INK = '#5b4638';
const SOFT = '#8a7466';
const PANEL = '#fffaf2';
const RIM = '#f0dcc4';
const CORAL = '#ff8a80';
const MINT = '#3fae7f';
const MINT_SOFT = '#dff5ea';
const GO_HIDE_MS = 900;
/** The message pill sits at the top, except in the lobby, where it goes between the join card and the slots. */
const MESSAGE_TOP = '56px';
const MESSAGE_TOP_LOBBY = '590px';

const STYLE = `
.rc-panel{background:${PANEL};border-radius:48px;box-shadow:0 12px 0 ${RIM};box-sizing:border-box;color:${INK};}
.rc-dot{display:inline-block;border-radius:50%;border:6px solid #fff;box-shadow:0 4px 0 rgba(91,70,56,.15);flex:none;}
.rc-pop{animation:rc-pop .45s cubic-bezier(.2,1.6,.4,1) both;}
@keyframes rc-pop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
`;

type El = HTMLElement;

export interface LobbySlot {
  /** Player name; '' for an empty slot. */
  name: string;
  color: string;
  /** For an empty slot: a bot will drive it (else it is free). For a player: they dropped and a bot drives. */
  bot: boolean;
  host: boolean;
}

interface LobbyUi {
  code: El;
  qr: HTMLImageElement;
  qrSpot: El;
  url: El;
  hint: El;
  slots: El;
}

export interface RaceRow {
  name: string;
  color: string;
  lap: number;
  item: string | null;
}

function sameRows(a: readonly RaceRow[], b: readonly RaceRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.name !== y.name || x.color !== y.color || x.lap !== y.lap || x.item !== y.item) return false;
  }
  return true;
}

function el(tag: string, css = '', text?: string, cls?: string): El {
  const node = document.createElement(tag);
  if (css) node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function dot(color: string, size: number): El {
  const d = el('span', `width:${size}px;height:${size}px;background:${color};`);
  d.className = 'rc-dot';
  return d;
}

/** One lobby slot: a big colour dot, the name, and a small tag (Host / Bot / Free). */
function slotCard(s: LobbySlot): El {
  const empty = s.name === '';
  const card = el('div', 'flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;padding:28px 20px 24px;', undefined, 'rc-panel');
  if (empty) {
    card.style.background = s.bot ? '#fbf1e4' : 'rgba(255,250,242,.55)';
    card.style.boxShadow = 'none';
    card.style.border = `5px dashed ${RIM}`;
  }
  const d = dot(s.color, 84);
  if (empty) d.style.opacity = s.bot ? '0.55' : '0.25';
  card.append(d);
  const label = empty ? (s.bot ? 'Bot' : 'Free') : s.name;
  card.append(
    el(
      'div',
      `max-width:100%;margin-top:14px;font-size:46px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${empty ? SOFT : INK};`,
      label,
    ),
  );
  const tag = s.host ? 'Host' : !empty && s.bot ? 'Bot' : '';
  card.append(el('div', `height:34px;font-size:30px;font-weight:900;color:${s.host ? CORAL : SOFT};`, tag));
  return card;
}

const ordinal = (n: number): string => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return n + s;
};

/** HTML overlay with big rounded pastel panels: lobby, countdown, race list, results and a message pill. */
export class Hud {
  private lobbyEl: El;
  private countdownEl: El;
  private raceEl: El;
  private resultsEl: El;
  private messageEl: El;
  /** Rows last drawn by `race`, compared field by field so unchanged frames allocate nothing. */
  private raceRows: RaceRow[] = [];
  private raceDirty = true;
  private goTimer: number | undefined;
  private lobbyUi: LobbyUi | null = null;
  private lobbyKey = '';

  constructor(private root: HTMLElement) {
    root.textContent = '';
    if (!document.getElementById('rc-hud-style')) {
      const style = el('style');
      style.id = 'rc-hud-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    const layer = (css: string): El => {
      const d = el('div', 'position:absolute;display:none;' + css);
      root.appendChild(d);
      return d;
    };
    // Explicit edges, not `inset`: that shorthand arrived in Chrome 87 and the TV is ~Chrome 85.
    this.lobbyEl = layer('top:48px;right:48px;bottom:48px;left:48px;gap:48px;');
    this.raceEl = layer('left:40px;top:40px;width:470px;padding:22px 26px;flex-direction:column;gap:6px;');
    this.raceEl.className = 'rc-panel';
    this.resultsEl = layer('top:0;right:0;bottom:0;left:0;align-items:center;justify-content:center;');
    // Upper third, so the bubble never hides the karts the camera keeps centred.
    this.countdownEl = layer('left:0;right:0;top:110px;justify-content:center;');
    this.messageEl = layer(`left:0;right:0;top:${MESSAGE_TOP};justify-content:center;`);
  }

  private placeMessage(top: string): void {
    if (this.messageEl.style.top !== top) this.messageEl.style.top = top;
  }

  /** Writes `display` only when it changes (`race` runs every frame). */
  private show(node: El, on: boolean): void {
    const want = on ? 'flex' : 'none';
    if (node.style.display !== want) node.style.display = want;
  }

  /**
   * Lobby: join card (room code, QR at its native pixel size, short URL), a host hint and a row of
   * all slots. Cheap to call often: the DOM is built once and only touched when something changed.
   * Empty slots have `name: ''`; `bot` then means a bot will drive that kart, otherwise it is free.
   */
  lobby(code: string, qrDataUrl: string, url: string, slots: readonly LobbySlot[], hint: string): void {
    this.show(this.raceEl, false);
    this.show(this.resultsEl, false);
    this.raceDirty = true;
    this.placeMessage(MESSAGE_TOP_LOBBY);
    const box = this.lobbyEl;
    this.show(box, true);
    const key = JSON.stringify([code, qrDataUrl, url, slots, hint]);
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    const ui = this.lobbyUi || (this.lobbyUi = this.buildLobby());

    ui.code.textContent = code || '····';
    ui.code.style.color = code ? INK : RIM;
    ui.url.textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if ((ui.qr.getAttribute('src') || '') !== qrDataUrl) {
      // The placeholder stays until the new image has loaded (see onload).
      ui.qr.style.display = 'none';
      ui.qrSpot.style.display = 'block';
      if (qrDataUrl) ui.qr.src = qrDataUrl;
      else ui.qr.removeAttribute('src');
    }
    ui.hint.textContent = hint;
    ui.hint.style.display = hint ? 'block' : 'none';

    ui.slots.textContent = '';
    for (const s of slots) ui.slots.append(slotCard(s));
  }

  private buildLobby(): LobbyUi {
    const box = this.lobbyEl;
    box.style.flexDirection = 'column';
    box.style.justifyContent = 'space-between';

    const top = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:40px;');
    const card = el('div', 'flex:none;display:flex;align-items:center;gap:48px;padding:36px 56px 36px 36px;', undefined, 'rc-panel');
    const qr = document.createElement('img');
    qr.alt = 'QR code to join';
    // Shown at exactly its own pixel size so the TV never rescales it by a fractional factor.
    qr.style.cssText = 'display:none;image-rendering:pixelated;border-radius:20px;background:#fff;flex:none;';
    const qrSpot = el('div', `width:320px;height:320px;border-radius:20px;background:${RIM};flex:none;`);
    qr.onload = () => {
      qr.style.width = `${qr.naturalWidth}px`;
      qr.style.height = `${qr.naturalHeight}px`;
      qr.style.display = 'block';
      qrSpot.style.display = 'none';
    };
    const words = el('div', 'min-width:600px;display:flex;flex-direction:column;align-items:flex-start;');
    const code = el('div', 'font-size:170px;line-height:1;font-weight:900;letter-spacing:0.1em;margin:6px 0 18px;white-space:nowrap;');
    const url = el('div', `font-size:32px;color:${SOFT};`);
    words.append(
      el('div', `font-size:52px;font-weight:900;color:${CORAL};`, 'Racing Carts'),
      el('div', `font-size:36px;color:${SOFT};margin-top:18px;`, 'Room code'),
      code,
      url,
    );
    card.append(qr, qrSpot, words);
    // Usually one line; a long room code can squeeze it onto two, which still reads fine.
    const hint = el(
      'div',
      `margin-top:24px;padding:22px 44px;font-size:42px;line-height:1.2;font-weight:900;color:#1f5a41;background:${MINT_SOFT};` +
        `border-radius:56px;box-shadow:0 8px 0 #bfe6d2;text-align:center;min-width:0;`,
    );
    top.append(card, hint);

    const slots = el('div', 'display:flex;gap:28px;');
    box.append(top, slots);
    return { code, qr, qrSpot, url, hint, slots };
  }

  countdown(n: number | 'GO'): void {
    window.clearTimeout(this.goTimer);
    const box = this.countdownEl;
    box.textContent = '';
    const go = n === 'GO';
    const bubble = el(
      'div',
      `width:260px;height:260px;border-radius:50%;display:flex;align-items:center;justify-content:center;` +
        `font-size:${go ? 110 : 170}px;font-weight:900;color:#fff;background:${go ? '#9BE7C4' : CORAL};` +
        `box-shadow:0 16px 0 ${go ? '#6cc9a0' : '#e8675d'};text-shadow:0 6px 0 rgba(91,70,56,.18);`,
      go ? 'GO!' : String(n),
      'rc-pop',
    );
    box.append(bubble);
    this.show(box, true);
    if (go) this.goTimer = window.setTimeout(() => this.show(box, false), GO_HIDE_MS);
  }

  race(rows: readonly RaceRow[]): void {
    this.show(this.lobbyEl, false);
    this.show(this.resultsEl, false);
    this.show(this.raceEl, true);
    this.placeMessage(MESSAGE_TOP);
    // Called every frame: only touch the DOM when a row changed.
    if (!this.raceDirty && sameRows(rows, this.raceRows)) return;
    this.raceDirty = false;
    this.raceRows = rows.map((r) => ({ name: r.name, color: r.color, lap: r.lap, item: r.item }));
    const box = this.raceEl;
    box.textContent = '';
    rows.forEach((r, i) => {
      const row = el('div', 'display:flex;align-items:center;gap:16px;height:62px;');
      row.append(
        el('div', `width:44px;font-size:40px;font-weight:900;text-align:right;color:${i === 0 ? CORAL : INK};`, String(i + 1)),
        dot(r.color, 44),
        el('div', 'flex:1;min-width:0;font-size:34px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', r.name),
      );
      if (r.item) row.append(el('div', `font-size:24px;padding:4px 14px;border-radius:999px;background:#ffe9cf;`, r.item));
      row.append(el('div', `font-size:28px;color:${SOFT};white-space:nowrap;`, `${Math.min(r.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`));
      box.append(row);
    });
  }

  results(rows: { name: string; color: string }[], hostHint: string): void {
    this.show(this.lobbyEl, false);
    this.show(this.raceEl, false);
    this.placeMessage(MESSAGE_TOP);
    this.raceDirty = true;
    const box = this.resultsEl;
    box.textContent = '';
    const panel = el('div', 'width:820px;padding:40px 56px;display:flex;flex-direction:column;align-items:stretch;gap:10px;', undefined, 'rc-panel rc-pop');
    panel.append(el('div', `font-size:72px;font-weight:900;color:${CORAL};text-align:center;margin-bottom:12px;`, 'Results'));
    rows.forEach((r, i) => {
      const row = el('div', `display:flex;align-items:center;gap:24px;height:${i === 0 ? 96 : 76}px;`);
      row.append(
        el('div', `width:120px;font-size:${i === 0 ? 56 : 44}px;font-weight:900;color:${i === 0 ? CORAL : SOFT};`, ordinal(i + 1)),
        dot(r.color, i === 0 ? 72 : 56),
        el('div', `font-size:${i === 0 ? 60 : 46}px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`, r.name),
      );
      panel.append(row);
    });
    if (hostHint) panel.append(el('div', `font-size:34px;color:${MINT};text-align:center;margin-top:20px;`, hostHint));
    box.append(panel);
    this.show(box, true);
  }

  message(text: string | null): void {
    const box = this.messageEl;
    box.textContent = '';
    if (text === null) {
      this.show(box, false);
      return;
    }
    box.append(el('div', 'padding:26px 56px;font-size:52px;font-weight:900;text-align:center;', text, 'rc-panel rc-pop'));
    this.show(box, true);
  }
}
