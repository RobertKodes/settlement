import type { VenueQuote } from "./types.js";

/**
 * All-in execution score (blueprint section 8): not the headline rate. Net output after every fee,
 * discounted for latency and for settlement uncertainty, and a hard zero for venues we cannot execute
 * or that the intent excludes. Higher is better; units are input base units so scores are comparable.
 */
export function allInScore(q: VenueQuote, opts: { latencyPenaltyPerSecond?: bigint } = {}): number {
  if (!q.executable) return 0;
  const penaltyPerSecond = opts.latencyPenaltyPerSecond ?? 0n; // base units per second of expected delay
  const net =
    q.amountOut -
    q.networkFeeBaseUnits -
    q.crossChainFeeBaseUnits -
    penaltyPerSecond * BigInt(Math.ceil(q.latencySeconds));
  const certain = Number(net) * q.settlementCertainty;
  return Math.max(0, certain);
}
