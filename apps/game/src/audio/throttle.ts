/** Lets one call through per key per `intervalMs` (e.g. one wall-bump sound per kart per 0.3 s). Allocation-free once warm. */
export class Throttle {
  private last = new Map<number, number>();

  constructor(private readonly intervalMs: number) {}

  allow(key: number, nowMs: number): boolean {
    const prev = this.last.get(key);
    // `nowMs < prev` means the clock restarted; do not stay muted until it catches up.
    if (prev !== undefined && nowMs >= prev && nowMs - prev < this.intervalMs) return false;
    this.last.set(key, nowMs);
    return true;
  }
}
