import {
  KART_COLORS,
  MAX_PLAYERS,
  NEUTRAL_INPUT,
  TOTAL_LAPS,
  type ClientMsg,
  type InputSnapshot,
  type ServerMsg,
} from '@rc/shared';
import { botInput, createBotBrain, type BotBrain } from './bots/bot';
import type { Driver, Game } from './game';
import type { PlayerRegistry } from './net/players';
import { getPowerup } from './powerups/registry';
import { lapOf, rankKarts } from './race/progress';
import type { LobbySlot } from './render/hud';

/** The desktop keyboard joins as this player token (it never receives messages). */
export const KEYBOARD_TOKEN = 'keyboard';
/** Names for karts nobody owns; they follow the slot colours. */
export const BOT_NAMES: readonly string[] = ['Coral', 'Sky', 'Mint', 'Butter', 'Lavender', 'Peach'];

/** The simulation runs at a fixed 60 Hz (see FixedStepper), so bot drivers step their brain by this much. */
const BOT_DT = 1 / 60;

type StateMsg = Extract<ServerMsg, { t: 'state' }>;

/** A phone's latest input plus an item press not yet seen by a step, and the snapshot handed to the game. */
interface PhoneInput extends InputSnapshot {
  itemLatch: boolean;
  out: InputSnapshot;
}

export interface SessionOptions {
  /** Bots added on top of the humans when a race starts (capped at MAX_PLAYERS karts in total). */
  maxBots: number;
  keyboard?: { input(): InputSnapshot };
  /** Called once for each new phone that gets a slot (not for a returning phone or the keyboard); used for a sound. */
  onJoin?: (token: string) => void;
  /** Clock in ms (default `performance.now`); injectable for tests. */
  now?: () => number;
  /** Random source for bot personalities (default `Math.random`); injectable for tests. */
  rand?: () => number;
}

/** Unchanged state is still resent this often, so a phone can tell a quiet TV from a lost one. */
export const STATE_HEARTBEAT_MS = 1000;

/**
 * Glue between the network (tokens and messages), the player registry and the game: who drives
 * which kart, host-only commands, and the `state` each phone sees.
 */
export class Session {
  /** Latest input per token, only filled while racing. */
  private inputs = new Map<string, PhoneInput>();
  /** JSON and time of the last `state` sent per token: unchanged state is only resent as a heartbeat. */
  private lastSent = new Map<string, { json: string; at: number }>();
  private readonly now: () => number;
  /** One reusable driver per token / slot, so the render loop allocates nothing. */
  private humanDrivers = new Map<string, Driver>();
  private botDrivers: Driver[];
  /** One brain per kart id, created at every race start (human slots too, for when they drop). */
  private brains: BotBrain[] = [];
  private readonly rand: () => number;
  /**
   * While showing results: the tokens that were connected when the race ended. Anyone else (a phone that
   * joined or came back afterwards) gets position 0, since a bot drove that kart. Null outside results.
   */
  private resultTokens: Set<string> | null = null;

  constructor(
    private game: Game,
    private registry: PlayerRegistry,
    private send: (token: string, msg: ServerMsg) => void,
    private opts: SessionOptions,
  ) {
    this.now = opts.now ?? (() => performance.now());
    this.rand = opts.rand ?? Math.random;
    this.botDrivers = BOT_NAMES.map((name, id): Driver => ({ kind: 'bot', name, input: () => this.botInputFor(id) }));
    if (opts.keyboard) registry.join(KEYBOARD_TOKEN, 'Keyboard', game.race.phase);
    this.refreshLobbyKarts();
  }

  onHello(token: string, name: string): ServerMsg | null {
    if (token === KEYBOARD_TOKEN) return { t: 'lobbyFull' }; // reserved for the TV's own keyboard
    this.noteRaceEnd();
    this.purgeExpired();
    let res = this.registry.join(token, name, this.game.race.phase);
    if (res === 'full' && this.game.race.phase === 'results' && this.removeDisconnected()) {
      // The race is over, so players who left no longer need their slots: make room for the newcomer.
      res = this.registry.join(token, name, this.game.race.phase);
    }
    if (res === 'full') return { t: 'lobbyFull' };
    this.inputs.delete(token);
    this.lastSent.delete(token);
    this.send(token, { t: 'welcome', slot: res.slot, color: KART_COLORS[res.slot] });
    this.refreshLobbyKarts();
    this.syncPhones();
    if (!res.rejoined) this.opts.onJoin?.(token);
    return null;
  }

  onMessage(token: string, msg: ClientMsg): void {
    this.noteRaceEnd();
    const p = this.registry.byToken(token);
    if (!p || !p.connected) return;
    const race = this.game.race;
    switch (msg.t) {
      case 'input':
        if (race.phase === 'racing') {
          const prev = this.inputs.get(token);
          const next = prev ?? { steer: 0, gas: false, brake: false, item: false, itemLatch: false, out: { ...NEUTRAL_INPUT } };
          next.steer = msg.steer;
          next.gas = msg.gas;
          next.brake = msg.brake;
          next.item = msg.item;
          // A press stays latched until a step reads it, even if the release arrives first.
          next.itemLatch = next.itemLatch || msg.item;
          this.inputs.set(token, next);
        }
        break;
      case 'start':
        if (race.phase === 'lobby' && this.isHost(token)) this.startRace(this.kartCount());
        break;
      case 'rematch':
        // Same grid back again, minus players who left (bots fill their karts); a phone that joined
        // mid-race or during the results in a kartless slot gets its kart now.
        if (race.phase === 'results' && this.isHost(token)) {
          this.removeDisconnected();
          this.startRace(Math.max(this.game.karts.length, this.highestSlot() + 1));
        }
        break;
    }
  }

  onDisconnect(token: string): void {
    this.noteRaceEnd();
    // In the lobby the slot is held for a grace period, so a phone that blips keeps its place.
    this.registry.disconnect(token, this.game.race.phase, this.now());
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
          input: keyboard ? () => keyboard.input() : () => this.phoneInput(token),
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

  /**
   * Sends `state` to every connected phone whose state changed, and resends it unchanged at least
   * every STATE_HEARTBEAT_MS (the phone treats a silent TV as a lost connection). In the lobby it
   * also removes players whose grace period ran out.
   */
  syncPhones(): void {
    const now = this.now();
    this.noteRaceEnd();
    this.purgeExpired();
    const karts = this.game.karts;
    const lobby = this.game.race.phase === 'lobby';
    const raced = this.resultTokens;
    const ranked = lobby ? [] : rankKarts(karts);
    const players = this.registry.all();
    const host = this.registry.hostToken();
    for (const p of players) {
      if (!p.connected || p.token === KEYBOARD_TOKEN) continue;
      // No kart to report: the lobby, or results for a race this phone was not in at the end.
      const kart = lobby || (raced && !raced.has(p.token)) ? undefined : karts.find((k) => k.id === p.slot);
      const msg: StateMsg = {
        t: 'state',
        phase: this.game.race.phase,
        isHost: p.token === host,
        // 0 = no place to show (lobby, a phone in a slot with no kart this race, or one that missed the end).
        position: kart ? ranked.indexOf(kart) + 1 : 0,
        racers: lobby ? players.length : karts.length,
        lap: kart ? lapOf(kart, this.game.track) : 1,
        totalLaps: TOTAL_LAPS,
        item: kart ? kart.item : null,
        itemIcon: kart && kart.item !== null ? getPowerup(kart.item)?.icon ?? null : null,
        rolling: kart ? kart.rolling !== null : false,
      };
      const json = JSON.stringify(msg);
      const last = this.lastSent.get(p.token);
      if (last && last.json === json && now - last.at < STATE_HEARTBEAT_MS) continue;
      this.lastSent.set(p.token, { json, at: now });
      this.send(p.token, msg);
    }
  }

  /** Tells the phone driving `kartId` (if any) about something that happened to its kart. */
  sendEvent(kartId: number, kind: 'hit' | 'itemGot' | 'finish'): void {
    const p = this.registry.bySlot(kartId);
    if (!p || !p.connected || p.token === KEYBOARD_TOKEN) return;
    this.send(p.token, { t: 'event', kind });
  }

  /**
   * The phone's latest input for one fixed step: `item` is the held level or a press latched since the
   * last step (cleared here, so the next step sees the real level). Reuses one snapshot per phone.
   */
  private phoneInput(token: string): InputSnapshot {
    const p = this.inputs.get(token);
    if (!p) return NEUTRAL_INPUT;
    const out = p.out;
    out.steer = p.steer;
    out.gas = p.gas;
    out.brake = p.brake;
    out.item = p.item || p.itemLatch;
    p.itemLatch = false;
    return out;
  }

  /** Relays what happened to karts during the latest steps: spin-out hits and finished item rolls. */
  flushKartEvents(): void {
    for (const id of this.game.world.drainHits()) this.sendEvent(id, 'hit');
    for (const id of this.game.drainItemGot()) this.sendEvent(id, 'itemGot');
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
    this.brains = this.game.karts.map(() => createBotBrain(this.rand));
    this.inputs.clear();
    this.game.race.start();
    this.syncPhones();
  }

  /** What the bot driving `kartId` does this step. Allocation-free apart from the input snapshot itself. */
  private botInputFor(kartId: number): InputSnapshot {
    const karts = this.game.karts;
    for (let i = 0; i < karts.length; i++) {
      if (karts[i].id !== kartId) continue;
      const brain = this.brains[kartId] ?? (this.brains[kartId] = createBotBrain(this.rand));
      return botInput(brain, karts[i], this.game.track, BOT_DT, this.rand, this.game.world);
    }
    return NEUTRAL_INPUT;
  }

  /**
   * Called first by every entry point, so it sees the race end before any join, leave or rejoin that
   * follows it (phases only change inside `game.step`): remembers who was connected at that moment.
   */
  private noteRaceEnd(): void {
    if (this.game.race.phase !== 'results') {
      this.resultTokens = null;
    } else if (this.resultTokens === null) {
      this.resultTokens = new Set();
      for (const p of this.registry.all()) if (p.connected) this.resultTokens.add(p.token);
    }
  }

  /** Removes every disconnected player (between races) and forgets their per-phone state; returns how many. */
  private removeDisconnected(): number {
    const gone = this.registry.removeDisconnected();
    for (const t of gone) {
      this.lastSent.delete(t);
      this.humanDrivers.delete(t);
      this.inputs.delete(t);
    }
    return gone.length;
  }

  /** Lobby only: drops players whose grace period ran out (in a race a dropped slot is kept until the rematch). */
  private purgeExpired(): void {
    if (this.game.race.phase !== 'lobby') return;
    const gone = this.registry.purgeExpired(this.now());
    if (gone.length === 0) return;
    for (const t of gone) {
      this.lastSent.delete(t);
      this.humanDrivers.delete(t);
    }
    this.refreshLobbyKarts();
  }

  /** In the lobby the grid previews the lineup, so a kart appears as each player joins. */
  private refreshLobbyKarts(): void {
    if (this.game.race.phase !== 'lobby') return;
    const n = this.kartCount();
    if (this.game.karts.length !== n) this.game.setupKarts(n);
  }
}
