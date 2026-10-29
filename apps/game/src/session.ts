import {
  KART_COLORS,
  MAX_PLAYERS,
  NEUTRAL_INPUT,
  TOTAL_LAPS,
  type ClientMsg,
  type InputSnapshot,
  type ServerMsg,
} from '@rc/shared';
import type { Driver, Game } from './game';
import type { PlayerRegistry } from './net/players';
import { lapOf, rankKarts } from './race/progress';
import type { LobbySlot } from './render/hud';

/** The desktop keyboard joins as this player token (it never receives messages). */
export const KEYBOARD_TOKEN = 'keyboard';
/** Names for karts nobody owns; they follow the slot colours. */
export const BOT_NAMES: readonly string[] = ['Coral', 'Sky', 'Mint', 'Butter', 'Lavender', 'Peach'];

type StateMsg = Extract<ServerMsg, { t: 'state' }>;

export interface SessionOptions {
  /** Bots added on top of the humans when a race starts (capped at MAX_PLAYERS karts in total). */
  maxBots: number;
  keyboard?: { input(): InputSnapshot };
}

/**
 * Glue between the network (tokens and messages), the player registry and the game: who drives
 * which kart, host-only commands, and the `state` each phone sees.
 */
export class Session {
  /** Latest input per token, only filled while racing. */
  private inputs = new Map<string, InputSnapshot>();
  /** JSON of the last `state` sent per token, so unchanged state is not resent. */
  private lastSent = new Map<string, string>();
  /** One reusable driver per token / slot, so the render loop allocates nothing. */
  private humanDrivers = new Map<string, Driver>();
  private botDrivers: Driver[];

  constructor(
    private game: Game,
    private registry: PlayerRegistry,
    private send: (token: string, msg: ServerMsg) => void,
    private opts: SessionOptions,
  ) {
    this.botDrivers = BOT_NAMES.map((name): Driver => ({ kind: 'bot', name, input: () => NEUTRAL_INPUT }));
    if (opts.keyboard) registry.join(KEYBOARD_TOKEN, 'Keyboard', game.race.phase);
    this.refreshLobbyKarts();
  }

  onHello(token: string, name: string): ServerMsg | null {
    const res = this.registry.join(token, name, this.game.race.phase);
    if (res === 'full') return { t: 'lobbyFull' };
    this.inputs.delete(token);
    this.lastSent.delete(token);
    this.send(token, { t: 'welcome', slot: res.slot, color: KART_COLORS[res.slot] });
    this.refreshLobbyKarts();
    this.syncPhones();
    return null;
  }

  onMessage(token: string, msg: ClientMsg): void {
    const p = this.registry.byToken(token);
    if (!p || !p.connected) return;
    const race = this.game.race;
    switch (msg.t) {
      case 'input':
        if (race.phase === 'racing') {
          this.inputs.set(token, { steer: msg.steer, gas: msg.gas, brake: msg.brake, item: msg.item });
        }
        break;
      case 'start':
        if (race.phase === 'lobby' && this.isHost(token)) this.startRace(this.kartCount());
        break;
      case 'rematch':
        // Same lineup back on the grid; a phone that joined mid-race in a kartless slot gets one now.
        if (race.phase === 'results' && this.isHost(token)) {
          this.startRace(Math.max(this.game.karts.length, this.highestSlot() + 1));
        }
        break;
    }
  }

  onDisconnect(token: string): void {
    this.registry.disconnect(token, this.game.race.phase);
    this.inputs.delete(token);
    this.lastSent.delete(token);
    this.refreshLobbyKarts();
    this.syncPhones();
  }

  /** Connected human → their latest input; anything else → the bot driver for that slot. */
  driverFor(kartId: number): Driver {
    const p = this.registry.bySlot(kartId);
    if (p && p.connected) {
      let d = this.humanDrivers.get(p.token);
      if (!d) {
        const token = p.token;
        const keyboard = token === KEYBOARD_TOKEN ? this.opts.keyboard : undefined;
        d = {
          kind: 'human',
          name: p.name,
          input: keyboard ? () => keyboard.input() : () => this.inputs.get(token) ?? NEUTRAL_INPUT,
        };
        this.humanDrivers.set(token, d);
      }
      d.name = p.name; // a rejoin may bring a new name
      return d;
    }
    const bot = this.botDrivers[kartId] ?? this.botDrivers[0];
    // A dropped player's kart keeps their name while a bot drives it.
    bot.name = p ? p.name : BOT_NAMES[kartId] ?? 'Bot';
    return bot;
  }

  /** Sends `state` to every connected phone whose state changed since the last send. */
  syncPhones(): void {
    const karts = this.game.karts;
    const lobby = this.game.race.phase === 'lobby';
    const ranked = lobby ? [] : rankKarts(karts);
    const players = this.registry.all();
    const host = this.registry.hostToken();
    for (const p of players) {
      if (!p.connected || p.token === KEYBOARD_TOKEN) continue;
      const kart = lobby ? undefined : karts.find((k) => k.id === p.slot);
      const msg: StateMsg = {
        t: 'state',
        phase: this.game.race.phase,
        isHost: p.token === host,
        // 0 = no place to show (lobby, or a phone that joined into a slot with no kart this race).
        position: kart ? ranked.indexOf(kart) + 1 : 0,
        racers: lobby ? players.length : karts.length,
        lap: kart ? lapOf(kart, this.game.track) : 1,
        totalLaps: TOTAL_LAPS,
        // Items arrive in Task 11.
        item: null,
        itemIcon: null,
        rolling: false,
      };
      const json = JSON.stringify(msg);
      if (this.lastSent.get(p.token) === json) continue;
      this.lastSent.set(p.token, json);
      this.send(p.token, msg);
    }
  }

  /** Tells the phone driving `kartId` (if any) about something that happened to its kart. */
  sendEvent(kartId: number, kind: 'hit' | 'itemGot' | 'finish'): void {
    const p = this.registry.bySlot(kartId);
    if (!p || !p.connected || p.token === KEYBOARD_TOKEN) return;
    this.send(p.token, { t: 'event', kind });
  }

  /** All MAX_PLAYERS slots for the lobby screen: players, then bot slots, then free slots. */
  lobbySlots(): LobbySlot[] {
    const host = this.registry.hostToken();
    const karts = this.kartCount();
    const slots: LobbySlot[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = this.registry.bySlot(i);
      slots.push(
        p
          ? { name: p.name, color: KART_COLORS[i], bot: !p.connected, host: p.token === host }
          : { name: '', color: KART_COLORS[i], bot: i < karts, host: false },
      );
    }
    return slots;
  }

  private isHost(token: string): boolean {
    return this.registry.hostToken() === token;
  }

  /** Karts for slots 0..n-1: every player's slot plus bots, at most MAX_PLAYERS. */
  private kartCount(): number {
    const humans = this.registry.all().length;
    return Math.min(MAX_PLAYERS, Math.max(this.highestSlot() + 1, humans + Math.max(0, this.opts.maxBots)));
  }

  /** Highest slot held by any player (connected or not), or -1. */
  private highestSlot(): number {
    let highest = -1;
    for (const p of this.registry.all()) highest = Math.max(highest, p.slot);
    return highest;
  }

  private startRace(karts: number): void {
    this.game.setupKarts(karts);
    this.inputs.clear();
    this.game.race.start();
    this.syncPhones();
  }

  /** In the lobby the grid previews the lineup, so a kart appears as each player joins. */
  private refreshLobbyKarts(): void {
    if (this.game.race.phase !== 'lobby') return;
    const n = this.kartCount();
    if (this.game.karts.length !== n) this.game.setupKarts(n);
  }
}
