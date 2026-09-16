import type { Address, Hex } from "viem";

/**
 * Route plans (Architecture v2 §3): an intent becomes an ordered list of legs across systems. A leg is
 * executable, or BLOCKED with a stated reason (external dependency), never silently skipped.
 */
export type System = "lineth" | "arc" | "cctp" | "gateway" | "fiat" | "metapad";

export type LegKind =
  | "transfer" // same-chain ERC-20 transfer (account op)
  | "pool-swap" // our StableSwap or UniswapV2-compatible venue
  | "stablefx" // Circle StableFX RFQ + FxEscrow on Arc
  | "curve-buy" // Metapad bonding curve
  | "curve-sell"
  | "dvp" // DvPSettlement on the Lineth rollup
  | "cctp-transfer" // burn on source domain, mint on destination
  | "gateway-transfer"
  | "fiat-onramp"
  | "fiat-offramp";

export interface Leg {
  id: string; // stable within the plan: "1", "2", …
  system: System;
  kind: LegKind;
  chainId?: number;
  venue?: string; // native-stableswap | lineth-venue | arc-venue | arc-stablefx | metapad-curve | cctp | gateway | bridge
  assetIn: string;
  amountIn: bigint;
  assetOut: string;
  amountOut: bigint; // expected
  minAmountOut?: bigint;
  feeBaseUnits: bigint; // in assetIn units unless `feeAsset` says otherwise
  feeAsset?: string;
  latencySeconds: number;
  settlementCertainty: number; // 0..1
  executable: boolean;
  blockedReason?: string;
  /** Adapter-specific execution parameters (pool address and path, CCTP domains, escrow id, …). */
  params?: Record<string, unknown>;
}

export interface RoutePlan {
  id: string;
  legs: Leg[];
  assetIn: string;
  amountIn: bigint;
  assetOut: string;
  amountOut: bigint; // expected final output
  executable: boolean; // every leg executable
  blocked: string[]; // reasons, in leg order
  score: number; // all-in, see score.ts
  totalLatencySeconds: number;
  certainty: number; // product of leg certainties
}

export function summarize(id: string, legs: Leg[]): Omit<RoutePlan, "score"> {
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (!first || !last) throw new Error("a plan needs at least one leg");
  return {
    id,
    legs,
    assetIn: first.assetIn,
    amountIn: first.amountIn,
    assetOut: last.assetOut,
    amountOut: last.amountOut,
    executable: legs.every((l) => l.executable),
    blocked: legs
      .filter((l) => !l.executable)
      .map((l) => `${l.id} ${l.venue ?? l.kind}: ${l.blockedReason ?? "not executable"}`),
    totalLatencySeconds: legs.reduce((s, l) => s + l.latencySeconds, 0),
    certainty: legs.reduce((p, l) => p * l.settlementCertainty, 1),
  };
}

/** Leg-level all-in score: expected output net of fees, discounted by certainty and latency. Zero when blocked. */
export function scorePlan(p: Omit<RoutePlan, "score">, latencyPenaltyPerSecond = 10n): number {
  if (!p.executable) return 0;
  const net =
    p.amountOut -
    p.legs.reduce((s, l) => s + (l.feeAsset && l.feeAsset !== p.assetOut ? 0n : 0n), 0n) -
    latencyPenaltyPerSecond * BigInt(Math.ceil(p.totalLatencySeconds));
  return Math.max(0, Number(net) * p.certainty);
}

export type { Address, Hex };
