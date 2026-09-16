import type { Address, Hex } from "viem";

export type Stable = "USDC" | "EURC";

export interface SwapRequest {
  chainId: number;
  from: Stable;
  to: Stable;
  amountIn: bigint; // base units (6 decimals)
  maxSlippageBps?: number;
  allowedVenues?: readonly ("native" | "arc" | "external")[];
}

/** One venue's answer. `executable` is false when the venue cannot be settled from this chain today. */
export interface VenueQuote {
  venue: string; // native-stableswap | arc-stablefx | external-<name>
  family: "native" | "arc" | "external";
  amountOut: bigint;
  /** All costs in the input asset's base units, already reflected in amountOut where the venue charges in-kind. */
  feeBaseUnits: bigint;
  networkFeeBaseUnits: bigint;
  crossChainFeeBaseUnits: bigint;
  latencySeconds: number;
  /** 0..1, probability the leg settles as quoted (finality certainty, venue availability). */
  settlementCertainty: number;
  executable: boolean;
  validUntil: number; // unix seconds
  /** Executable venues describe how: for native, the pool and coin indexes. */
  execution?:
    | { kind: "stableswap"; pool: Address; i: number; j: number; minAmountOut: bigint }
    | { kind: "arc"; note: string };
  reason?: string;
}

export interface RouteDecision {
  chosen: VenueQuote;
  ranked: Array<VenueQuote & { score: number }>;
  /** Quote legs in the API's `route` shape. */
  legs: Array<{ venue: string; shareBps: number; chainId?: number }>;
}

export interface VenueAdapter {
  readonly family: VenueQuote["family"];
  quote(req: SwapRequest): Promise<VenueQuote | undefined>;
}

export type { Address, Hex };
