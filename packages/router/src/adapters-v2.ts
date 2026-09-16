import type { PublicClient } from "@settlement/chain";
import { venueRouterAbi } from "@settlement/contracts-abi";
import type { Address } from "viem";
import type { Leg } from "./plan.js";

/** Chain-generic UniswapV2 venue leg (our VenueRouter on the Lineth rollup or on Arc). */
export interface VenueV2Config {
  system: "lineth" | "arc";
  chainId: number;
  venue: string; // lineth-venue | arc-venue
  router: Address;
  tokens: Record<string, Address>; // symbol -> address
  networkFeeBaseUnits: bigint;
  latencySeconds: number;
}

export async function venueV2Leg(
  client: PublicClient,
  cfg: VenueV2Config,
  id: string,
  assetIn: string,
  assetOut: string,
  amountIn: bigint,
  maxSlippageBps = 50,
): Promise<Leg | undefined> {
  const tokenIn = cfg.tokens[assetIn];
  const tokenOut = cfg.tokens[assetOut];
  if (!tokenIn || !tokenOut) return undefined;
  try {
    const amounts = await client.readContract({
      address: cfg.router,
      abi: venueRouterAbi,
      functionName: "getAmountsOut",
      args: [amountIn, [tokenIn, tokenOut]],
    });
    const out = amounts[amounts.length - 1] ?? 0n;
    if (out === 0n)
      return blocked(id, cfg, assetIn, assetOut, amountIn, "no liquidity in the venue pair");
    return {
      id,
      system: cfg.system,
      kind: "pool-swap",
      chainId: cfg.chainId,
      venue: cfg.venue,
      assetIn,
      amountIn,
      assetOut,
      amountOut: out,
      minAmountOut: (out * (10_000n - BigInt(maxSlippageBps))) / 10_000n,
      feeBaseUnits: (amountIn * 30n) / 10_000n,
      latencySeconds: cfg.latencySeconds,
      settlementCertainty: 0.999,
      executable: true,
      params: { router: cfg.router, path: [tokenIn, tokenOut] },
    };
  } catch (e) {
    return blocked(
      id,
      cfg,
      assetIn,
      assetOut,
      amountIn,
      `venue unreachable: ${(e as Error).message.slice(0, 80)}`,
    );
  }
}

function blocked(
  id: string,
  cfg: VenueV2Config,
  assetIn: string,
  assetOut: string,
  amountIn: bigint,
  reason: string,
): Leg {
  return {
    id,
    system: cfg.system,
    kind: "pool-swap",
    chainId: cfg.chainId,
    venue: cfg.venue,
    assetIn,
    amountIn,
    assetOut,
    amountOut: 0n,
    feeBaseUnits: 0n,
    latencySeconds: 0,
    settlementCertainty: 0,
    executable: false,
    blockedReason: reason,
  };
}

/** CCTP V2 leg between two domains. Executable only when both ends have a domain (the Lineth rollup has none). */
export function cctpLeg(
  id: string,
  p: {
    asset: "USDC";
    amountIn: bigint;
    fromChainId: number;
    toChainId: number;
    fromDomain?: number | undefined;
    toDomain?: number | undefined;
    fast?: boolean;
    fastFeeBps?: number;
  },
): Leg {
  const ok = p.fromDomain !== undefined && p.toDomain !== undefined;
  const fast = p.fast ?? true;
  const fee = ok && fast ? (p.amountIn * BigInt(p.fastFeeBps ?? 1)) / 10_000n : 0n;
  return {
    id,
    system: "cctp",
    kind: "cctp-transfer",
    venue: "cctp",
    assetIn: p.asset,
    amountIn: p.amountIn,
    assetOut: p.asset,
    amountOut: p.amountIn - fee,
    feeBaseUnits: fee,
    latencySeconds: fast ? 20 : 15 * 60,
    settlementCertainty: ok ? 0.995 : 0,
    executable: ok,
    ...(ok
      ? {}
      : {
          blockedReason: `no CCTP domain for chain ${p.fromDomain === undefined ? p.fromChainId : p.toChainId} (needs Circle support)`,
        }),
    params: {
      fromChainId: p.fromChainId,
      toChainId: p.toChainId,
      fromDomain: p.fromDomain,
      toDomain: p.toDomain,
      minFinalityThreshold: fast ? 1000 : 2000,
    },
  };
}

/** Circle StableFX on Arc: permissioned RFQ + FxEscrow. Typed; BLOCKED until an institutional API key exists. */
export function stableFxLeg(
  id: string,
  p: {
    chainId: number;
    assetIn: "USDC" | "EURC";
    assetOut: "USDC" | "EURC";
    amountIn: bigint;
    indicativeRate6: bigint;
    apiKeyPresent: boolean;
  },
): Leg {
  const out =
    p.assetIn === "USDC"
      ? (p.amountIn * p.indicativeRate6) / 1_000_000n
      : (p.amountIn * 1_000_000n) / p.indicativeRate6;
  return {
    id,
    system: "arc",
    kind: "stablefx",
    chainId: p.chainId,
    venue: "arc-stablefx",
    assetIn: p.assetIn,
    amountIn: p.amountIn,
    assetOut: p.assetOut,
    amountOut: out,
    feeBaseUnits: 0n,
    latencySeconds: 2,
    settlementCertainty: p.apiKeyPresent ? 0.99 : 0,
    executable: p.apiKeyPresent,
    ...(p.apiKeyPresent
      ? {}
      : { blockedReason: "StableFX needs an institutional API key from Circle" }),
    params: { escrow: "0xe2E5F173576B513d994073CCbDaCBE027d43DFe6" },
  };
}

/**
 * Metapad bonding curve (handoff §"What exists today"): constant product with virtual reserves.
 * 1B supply, 800M on the curve, 200M reserved for the pool, 1.073B virtual tokens, virtual quote preset.
 * Quote math only; execution goes through Metapad's launchpad contract once its ABI is wired.
 */
export interface CurveState {
  virtualQuote: bigint;
  virtualTokens: bigint;
  soldTokens: bigint;
  raisedQuote: bigint;
  quoteDecimals: number;
}
export const METAPAD_CURVE = {
  supply: 1_000_000_000n * 10n ** 18n,
  onCurve: 800_000_000n * 10n ** 18n,
  reserved: 200_000_000n * 10n ** 18n,
  virtualTokens: 1_073_000_000n * 10n ** 18n,
};

export function curveBuyOut(state: CurveState, quoteIn: bigint): bigint {
  const x = state.virtualQuote + state.raisedQuote; // quote reserve
  const y = state.virtualTokens - state.soldTokens; // token reserve
  return y - (x * y) / (x + quoteIn); // constant product, no fee in the reference math
}

export function curveLeg(
  id: string,
  p: {
    chainId: number;
    launchpad?: Address;
    state: CurveState;
    quoteIn: bigint;
    token: string;
    deployed: boolean;
  },
): Leg {
  const out = curveBuyOut(p.state, p.quoteIn);
  const remaining = METAPAD_CURVE.onCurve - p.state.soldTokens;
  const graduates = out >= remaining;
  return {
    id,
    system: "metapad",
    kind: "curve-buy",
    chainId: p.chainId,
    venue: "metapad-curve",
    assetIn: "USDC",
    amountIn: p.quoteIn,
    assetOut: p.token,
    amountOut: graduates ? remaining : out,
    feeBaseUnits: 0n,
    latencySeconds: 3,
    settlementCertainty: p.deployed ? 0.99 : 0,
    executable: p.deployed,
    ...(p.deployed ? {} : { blockedReason: "Metapad launchpad not deployed on this chain" }),
    params: { launchpad: p.launchpad, graduates },
  };
}
