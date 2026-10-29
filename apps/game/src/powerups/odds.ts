import type { RollContext } from './types';

/** Race standing as a fraction: 0 = leader, 1 = last (0 when racing alone). Item weights are lines in this. */
export function rankFraction(ctx: RollContext): number {
  if (ctx.racerCount <= 1) return 0;
  return Math.max(0, Math.min(1, (ctx.position - 1) / (ctx.racerCount - 1)));
}
