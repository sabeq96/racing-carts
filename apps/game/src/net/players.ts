import { MAX_PLAYERS, type Phase } from '@rc/shared';

export interface PlayerInfo {
  token: string;
  name: string;
  slot: number;
  connected: boolean;
  joinOrder: number;
  /** When a lobby disconnect started the grace period (ms, caller's clock); null otherwise. */
  leftAt: number | null;
}

/** A player who drops in the lobby keeps their slot (and host turn) this long before being removed. */
export const LOBBY_GRACE_MS = 15000;

/** Tracks who is in the room. Pure logic: no networking. */
export class PlayerRegistry {
  private players = new Map<string, PlayerInfo>();
  private nextJoinOrder = 0;

  /**
   * Adds a player or reconnects a known token (keeping slot and joinOrder, updating name), e.g. a
   * phone back within the lobby grace period or mid-race. Returns 'full' when no slot is free (a
   * player in grace still holds their slot). The phase does not change join behaviour.
   */
  join(token: string, name: string, _phase: Phase): { slot: number; rejoined: boolean } | 'full' {
    const existing = this.players.get(token);
    if (existing) {
      existing.name = name;
      existing.connected = true;
      existing.leftAt = null;
      return { slot: existing.slot, rejoined: true };
    }
    const taken = new Set<number>();
    for (const p of this.players.values()) taken.add(p.slot);
    let slot = 0;
    while (slot < MAX_PLAYERS && taken.has(slot)) slot++;
    if (slot >= MAX_PLAYERS) return 'full';
    this.players.set(token, { token, name, slot, connected: true, joinOrder: this.nextJoinOrder++, leftAt: null });
    return { slot, rejoined: false };
  }

  /**
   * Marks the player disconnected, keeping their slot. In the lobby this starts a grace period
   * (`now` is the caller's clock in ms): `purgeExpired` removes them once it runs out. In other
   * phases the slot is kept for good (a bot drives the kart until they rejoin).
   */
  disconnect(token: string, phase: Phase, now = 0): void {
    const p = this.players.get(token);
    if (!p) return;
    p.connected = false;
    p.leftAt = phase === 'lobby' ? now : null;
  }

  /** Removes players whose lobby grace period has run out; returns their tokens. */
  purgeExpired(now: number): string[] {
    const gone: string[] = [];
    for (const p of this.players.values()) {
      if (!p.connected && p.leftAt !== null && now - p.leftAt >= LOBBY_GRACE_MS) gone.push(p.token);
    }
    for (const t of gone) this.players.delete(t);
    return gone;
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
