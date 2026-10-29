export const PEER_PREFIX = 'racingcarts-';
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const MAX_PLAYERS = 6;
export const TOTAL_LAPS = 3;
export const INPUT_HZ = 30;
/** Kart colours in slot order: coral, sky, mint, butter, lavender, peach. */
export const KART_COLORS: readonly string[] = [
  '#FF8A80',
  '#82B1FF',
  '#9BE7C4',
  '#FFE38A',
  '#C9B6F2',
  '#FFC09F',
];
export const CONTROLLER_URL = 'https://sabeq96.github.io/racing-carts/';

export type Phase = 'lobby' | 'countdown' | 'racing' | 'results';

export interface InputSnapshot {
  steer: number;
  gas: boolean;
  brake: boolean;
  item: boolean;
}

export type ClientMsg =
  | { t: 'hello'; token: string; name: string }
  | ({ t: 'input' } & InputSnapshot)
  | { t: 'start' }
  | { t: 'rematch' };

export type ServerMsg =
  | { t: 'welcome'; slot: number; color: string }
  | {
      t: 'state';
      phase: Phase;
      isHost: boolean;
      position: number;
      racers: number;
      lap: number;
      totalLaps: number;
      item: string | null;
      itemIcon: string | null;
      rolling: boolean;
    }
  | { t: 'event'; kind: 'hit' | 'itemGot' | 'finish' }
  | { t: 'lobbyFull' };

export const NEUTRAL_INPUT: InputSnapshot = { steer: 0, gas: false, brake: false, item: false };

const CODE_LENGTH = 4;
const MAX_NAME_LENGTH = 12;
const MAX_TOKEN_LENGTH = 64;

export function makeRoomCode(rand: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length)];
  }
  return code;
}

export function peerIdFor(code: string): string {
  return PEER_PREFIX + code.toUpperCase();
}

export function controllerUrl(code: string): string {
  return CONTROLLER_URL + '?address=' + code;
}

/** Accepts a plain object or a JSON string; returns a plain record or null. */
function toRecord(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function decodeClient(raw: unknown): ClientMsg | null {
  const m = toRecord(raw);
  if (!m) return null;
  switch (m.t) {
    case 'hello': {
      if (typeof m.token !== 'string' || m.token.length === 0 || m.token.length > MAX_TOKEN_LENGTH) return null;
      const name = (typeof m.name === 'string' ? m.name : '').trim().slice(0, MAX_NAME_LENGTH).trim();
      return { t: 'hello', token: m.token, name: name || 'Player' };
    }
    case 'input': {
      const steer =
        typeof m.steer === 'number' && Number.isFinite(m.steer) ? Math.max(-1, Math.min(1, m.steer)) : 0;
      return { t: 'input', steer, gas: Boolean(m.gas), brake: Boolean(m.brake), item: Boolean(m.item) };
    }
    case 'start':
      return { t: 'start' };
    case 'rematch':
      return { t: 'rematch' };
    default:
      return null;
  }
}

export function decodeServer(raw: unknown): ServerMsg | null {
  const m = toRecord(raw);
  if (!m) return null;
  switch (m.t) {
    case 'welcome':
      return { t: 'welcome', slot: m.slot as number, color: m.color as string };
    case 'state':
      return {
        t: 'state',
        phase: m.phase as Phase,
        isHost: m.isHost as boolean,
        position: m.position as number,
        racers: m.racers as number,
        lap: m.lap as number,
        totalLaps: m.totalLaps as number,
        item: m.item as string | null,
        itemIcon: m.itemIcon as string | null,
        rolling: m.rolling as boolean,
      };
    case 'event':
      return { t: 'event', kind: m.kind as 'hit' | 'itemGot' | 'finish' };
    case 'lobbyFull':
      return { t: 'lobbyFull' };
    default:
      return null;
  }
}
