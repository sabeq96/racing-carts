import { TOTAL_LAPS } from '@rc/shared';

const INK = '#5b4638';
const SOFT = '#8a7466';
const PANEL = '#fffaf2';
const RIM = '#f0dcc4';
const CORAL = '#ff8a80';
const MINT = '#3fae7f';
const GO_HIDE_MS = 900;

const STYLE = `
.rc-panel{background:${PANEL};border-radius:48px;box-shadow:0 12px 0 ${RIM};box-sizing:border-box;color:${INK};}
.rc-dot{display:inline-block;border-radius:50%;border:6px solid #fff;box-shadow:0 4px 0 rgba(91,70,56,.15);flex:none;}
.rc-pop{animation:rc-pop .45s cubic-bezier(.2,1.6,.4,1) both;}
@keyframes rc-pop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
`;

type El = HTMLElement;

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
  private raceKey = '';
  private goTimer: number | undefined;

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
    this.lobbyEl = layer('inset:48px;gap:48px;');
    this.raceEl = layer('left:40px;top:40px;width:470px;padding:22px 26px;flex-direction:column;gap:6px;');
    this.raceEl.className = 'rc-panel';
    this.resultsEl = layer('inset:0;align-items:center;justify-content:center;');
    // Upper third, so the bubble never hides the karts the camera keeps centred.
    this.countdownEl = layer('left:0;right:0;top:110px;justify-content:center;');
    this.messageEl = layer('left:0;right:0;top:56px;justify-content:center;');
  }

  private show(node: El, on: boolean): void {
    node.style.display = on ? 'flex' : 'none';
  }

  lobby(code: string, qrDataUrl: string, url: string, slots: { name: string; color: string; bot: boolean; host: boolean }[]): void {
    this.show(this.raceEl, false);
    this.show(this.resultsEl, false);
    const box = this.lobbyEl;
    box.textContent = '';

    const left = el(
      'div',
      'width:740px;padding:36px 44px;display:flex;flex-direction:column;align-items:center;',
      undefined,
      'rc-panel',
    );
    left.append(
      el('div', `font-size:56px;font-weight:900;color:${CORAL};`, 'Racing Carts'),
      el('div', `font-size:36px;color:${SOFT};margin-top:8px;`, 'Room code'),
      el('div', 'font-size:160px;line-height:1.05;font-weight:900;letter-spacing:0.12em;padding-left:0.12em;', code),
    );
    if (qrDataUrl) {
      const img = document.createElement('img');
      img.alt = 'QR code to join';
      img.style.cssText = 'image-rendering:pixelated;border-radius:24px;margin-top:12px;background:#fff;';
      img.src = qrDataUrl;
      left.append(img);
    }
    left.append(el('div', `font-size:26px;color:${SOFT};margin-top:16px;text-align:center;word-break:break-all;`, url.replace(/^https?:\/\//, '')));

    const right = el('div', 'flex:1;display:grid;grid-template-columns:1fr 1fr;gap:28px;align-content:center;');
    for (const s of slots) {
      const card = el('div', 'display:flex;align-items:center;gap:24px;padding:26px 30px;', undefined, 'rc-panel');
      if (s.bot) card.style.opacity = '0.7';
      const text = el('div', 'display:flex;flex-direction:column;min-width:0;');
      text.append(el('div', 'font-size:44px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', s.name));
      const tag = s.host ? 'Host' : s.bot ? 'Bot' : '';
      if (tag) text.append(el('div', `font-size:28px;color:${s.host ? CORAL : SOFT};`, tag));
      card.append(dot(s.color, 72), text);
      right.append(card);
    }
    box.append(left, right);
    this.show(box, true);
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

  race(rows: { name: string; color: string; lap: number; item: string | null }[]): void {
    this.show(this.lobbyEl, false);
    this.show(this.resultsEl, false);
    this.show(this.raceEl, true);
    const key = JSON.stringify(rows);
    if (key === this.raceKey) return; // called every frame: only touch the DOM on change
    this.raceKey = key;
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
    this.raceKey = '';
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
