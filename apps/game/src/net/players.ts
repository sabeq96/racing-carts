import { MAX_PLAYERS, type Phase } from '@rc/shared';

export interface PlayerInfo {
  token: string;
  name: string;
  slot: number;
  connected: boolean;
  joinOrder: number;
}

/** Tracks who is in the room. Pure logic: no networking. */
export class PlayerRegistry {
  private players = new Map<string, PlayerInfo>();
  private nextJoinOrder = 0;

  /**
   * Adds a player or reconnects a known token (keeping slot and joinOrder, updating name).
   * Returns 'full' when no slot is free. The phase does not change join behaviour:
   * lobby removes players on disconnect, so a known token only exists mid-race.
   */
  join(token: string, name: string, _phase: Phase): { slot: number; rejoined: boolean } | 'full' {
    const existing = this.players.get(token);
    if (existing) {
      existing.name = name;
      existing.connected = true;
      return { slot: existing.slot, rejoined: true };
    }
    const taken = new Set<number>();
    for (const p of this.players.values()) taken.add(p.slot);
    let slot = 0;
    while (slot < MAX_PLAYERS && taken.has(slot)) slot++;
    if (slot >= MAX_PLAYERS) return 'full';
    this.players.set(token, { token, name, slot, connected: true, joinOrder: this.nextJoinOrder++ });
    return { slot, rejoined: false };
  }

  /** Lobby: removes the player. Other phases: keeps the slot, marks disconnected. */
  disconnect(token: string, phase: Phase): void {
    const p = this.players.get(token);
    if (!p) return;
    if (phase === 'lobby') this.players.delete(token);
    else p.connected = false;
  }

  bySlot(slot: number): PlayerInfo | undefined {
    for (const p of this.players.values()) if (p.slot === slot) return p;
    return undefined;
  }

  byToken(token: string): PlayerInfo | undefined {
    return this.players.get(token);
  }

  /** All players sorted by slot. */
  all(): PlayerInfo[] {
    return [...this.players.values()].sort((a, b) => a.slot - b.slot);
  }

  /** Connected player with the lowest joinOrder, or null. */
  hostToken(): string | null {
    let best: PlayerInfo | null = null;
    for (const p of this.players.values()) {
      if (p.connected && (!best || p.joinOrder < best.joinOrder)) best = p;
    }
    return best ? best.token : null;
  }
}
