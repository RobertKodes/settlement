import type { PublicClient } from "@settlement/chain";
import { CHAINS, type ChainKey } from "@settlement/config";
import { cctpLeg, stableFxLeg, type VenueV2Config, venueV2Leg } from "./adapters-v2.js";
import { type Leg, type RoutePlan, scorePlan, summarize } from "./plan.js";

/** What the planner knows about each system. Everything optional: missing = that system's legs are BLOCKED. */
export interface PlannerConfig {
  lineth?: {
    client: PublicClient;
    venue?: VenueV2Config;
    stableswap?: { pool: `0x${string}`; coins: Record<string, number> };
  };
  arc?: {
    client?: PublicClient;
    venue?: VenueV2Config;
    stableFxApiKey?: boolean;
    indicativeUsdcEurc6?: bigint;
  };
  cctp?: { domains: Partial<Record<number, number>> }; // chainId -> domain
}

export interface PlanRequest {
  assetIn: string;
  assetOut: string;
  amountIn: bigint;
  /** Where the funds are now and where the output must end up. */
  fromChainId: number;
  toChainId: number;
  maxSlippageBps?: number;
  allowedSystems?: readonly ("lineth" | "arc" | "cctp" | "gateway" | "fiat" | "metapad")[];
}

const key = (chainId: number): ChainKey | undefined =>
  (Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].chainId === chainId);

/**
 * Enumerates candidate plans and ranks them. Candidates today:
 *  A. same-chain swap on that chain's venue (Lineth venue / StableSwap, or Arc venue)
 *  B. Arc FX: [cctp to Arc] -> stablefx -> [cctp back]
 *  C. Arc venue via rails: [cctp to Arc] -> arc venue swap -> [cctp back]
 * Legs that need an unavailable dependency are kept in the plan as BLOCKED so the UI can show *why* a route is not live.
 */
export async function planRoutes(cfg: PlannerConfig, req: PlanRequest): Promise<RoutePlan[]> {
  const allowed = new Set(
    req.allowedSystems ?? ["lineth", "arc", "cctp", "gateway", "fiat", "metapad"],
  );
  const plans: RoutePlan[] = [];
  const slippage = req.maxSlippageBps ?? 50;
  const arcChainId = CHAINS["arc-testnet"].chainId;
  const linethChainId = CHAINS["l2-devnet"].chainId;
  const domain = (chainId: number) => cfg.cctp?.domains[chainId];
  const finish = (id: string, legs: Leg[]) => {
    const s = summarize(id, legs);
    plans.push({ ...s, score: scorePlan(s) });
  };

  // A. same chain
  if (req.fromChainId === req.toChainId) {
    if (req.fromChainId === linethChainId && cfg.lineth?.venue && allowed.has("lineth")) {
      const leg = await venueV2Leg(
        cfg.lineth.client,
        cfg.lineth.venue,
        "1",
        req.assetIn,
        req.assetOut,
        req.amountIn,
        slippage,
      );
      if (leg) finish("lineth-venue", [leg]);
    }
    if (req.fromChainId === arcChainId && allowed.has("arc")) {
      if (cfg.arc?.venue && cfg.arc.client) {
        const leg = await venueV2Leg(
          cfg.arc.client,
          cfg.arc.venue,
          "1",
          req.assetIn,
          req.assetOut,
          req.amountIn,
          slippage,
        );
        if (leg) finish("arc-venue", [leg]);
      } else {
        finish("arc-venue", [
          {
            id: "1",
            system: "arc",
            kind: "pool-swap",
            chainId: arcChainId,
            venue: "arc-venue",
            assetIn: req.assetIn,
            amountIn: req.amountIn,
            assetOut: req.assetOut,
            amountOut: 0n,
            feeBaseUnits: 0n,
            latencySeconds: 0,
            settlementCertainty: 0,
            executable: false,
            blockedReason: "arc contracts not deployed (make arc-deploy)",
          },
        ]);
      }
      if (["USDC", "EURC"].includes(req.assetIn) && ["USDC", "EURC"].includes(req.assetOut)) {
        finish("arc-stablefx", [
          stableFxLeg("1", {
            chainId: arcChainId,
            assetIn: req.assetIn as "USDC" | "EURC",
            assetOut: req.assetOut as "USDC" | "EURC",
            amountIn: req.amountIn,
            indicativeRate6: cfg.arc?.indicativeUsdcEurc6 ?? 842_910n,
            apiKeyPresent: !!cfg.arc?.stableFxApiKey,
          }),
        ]);
      }
    }
  }

  // B/C. via Arc rails (from Lineth or any chain to Arc and back, or ending on Arc)
  if (
    req.fromChainId !== arcChainId &&
    allowed.has("cctp") &&
    allowed.has("arc") &&
    req.assetIn === "USDC" &&
    ["USDC", "EURC"].includes(req.assetOut)
  ) {
    const hop = cctpLeg("1", {
      asset: "USDC",
      amountIn: req.amountIn,
      fromChainId: req.fromChainId,
      toChainId: arcChainId,
      fromDomain: domain(req.fromChainId),
      toDomain: domain(arcChainId),
    });
    const fx = stableFxLeg("2", {
      chainId: arcChainId,
      assetIn: "USDC",
      assetOut: req.assetOut as "USDC" | "EURC",
      amountIn: hop.amountOut,
      indicativeRate6: cfg.arc?.indicativeUsdcEurc6 ?? 842_910n,
      apiKeyPresent: !!cfg.arc?.stableFxApiKey,
    });
    const legs = [hop, fx];
    if (req.toChainId !== arcChainId)
      legs.push({
        ...cctpLeg("3", {
          asset: "USDC",
          amountIn: fx.amountOut,
          fromChainId: arcChainId,
          toChainId: req.toChainId,
          fromDomain: domain(arcChainId),
          toDomain: domain(req.toChainId),
        }),
        assetIn: req.assetOut,
        assetOut: req.assetOut,
      });
    finish("via-arc-stablefx", legs);
  }
  return plans.sort((a, b) => b.score - a.score);
}

export function chainKeyOf(chainId: number): ChainKey | undefined {
  return key(chainId);
}
