import type { PublicClient } from "@settlement/chain";
import { stableSwapPoolAbi } from "@settlement/contracts-abi";
import { InMemoryArcAdapter } from "@settlement/integration-arc";
import type { Address } from "viem";
import type { SwapRequest, VenueAdapter, VenueQuote } from "./types.js";

export interface NativePoolConfig {
  pool: Address;
  /** coin index by symbol, e.g. { USDC: 0, EURC: 1 } */
  coins: Record<string, number>;
  /** approximate USDC cost of one swap through the paymaster on this chain (base units) */
  networkFeeBaseUnits: bigint;
}

/** Native StableSwap venue: on-chain getDy quote, executable through the account's batch call. */
export class NativeStableSwapAdapter implements VenueAdapter {
  readonly family = "native" as const;
  constructor(
    private readonly client: PublicClient,
    private readonly cfg: NativePoolConfig,
  ) {}

  async quote(req: SwapRequest): Promise<VenueQuote | undefined> {
    const i = this.cfg.coins[req.from];
    const j = this.cfg.coins[req.to];
    if (i === undefined || j === undefined || i === j) return undefined;
    try {
      const [dy, dyFee] = await this.client.readContract({
        address: this.cfg.pool,
        abi: stableSwapPoolAbi,
        functionName: "getDy",
        args: [BigInt(i), BigInt(j), req.amountIn],
      });
      const slippageBps = BigInt(req.maxSlippageBps ?? 30);
      return {
        venue: "native-stableswap",
        family: "native",
        amountOut: dy,
        feeBaseUnits: dyFee,
        networkFeeBaseUnits: this.cfg.networkFeeBaseUnits,
        crossChainFeeBaseUnits: 0n,
        latencySeconds: 3,
        settlementCertainty: 0.999,
        executable: true,
        validUntil: Math.floor(Date.now() / 1000) + 60,
        execution: {
          kind: "stableswap",
          pool: this.cfg.pool,
          i,
          j,
          minAmountOut: (dy * (10_000n - slippageBps)) / 10_000n,
        },
      };
    } catch (e) {
      return {
        venue: "native-stableswap",
        family: "native",
        amountOut: 0n,
        feeBaseUnits: 0n,
        networkFeeBaseUnits: 0n,
        crossChainFeeBaseUnits: 0n,
        latencySeconds: 0,
        settlementCertainty: 0,
        executable: false,
        validUntil: 0,
        reason: (e as Error).message,
      };
    }
  }
}

/**
 * Arc StableFX venue through the Arc adapter (ADR-0018). Quoted for comparison; not executable from the
 * devnet because moving funds to Arc needs CCTP/Gateway support for our chain (ADR-0017).
 */
export class ArcStableFxAdapter implements VenueAdapter {
  readonly family = "arc" as const;
  constructor(
    private readonly arc: InMemoryArcAdapter = new InMemoryArcAdapter(),
    private readonly crossChainFeeBaseUnits = 1_000_000n,
  ) {}

  async quote(req: SwapRequest): Promise<VenueQuote | undefined> {
    const q = await this.arc.quoteFx({ from: req.from, to: req.to, amountIn: req.amountIn });
    if (!q) return undefined;
    return {
      venue: q.venue,
      family: "arc",
      amountOut: q.amountOut,
      feeBaseUnits: 0n,
      networkFeeBaseUnits: 50_000n,
      crossChainFeeBaseUnits: this.crossChainFeeBaseUnits,
      latencySeconds: 20 * 60, // CCTP standard transfer to Arc and back
      settlementCertainty: 0.98,
      executable: false,
      validUntil: q.validUntil,
      execution: { kind: "arc", note: "requires CCTP/Gateway support for this chain (ADR-0017)" },
      reason: "not executable from this chain yet",
    };
  }
}
