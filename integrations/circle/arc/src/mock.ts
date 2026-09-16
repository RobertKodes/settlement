import { arcNativeToErc20Units } from "./decimals.js";
import type { ArcAdapter, ArcFxQuote, ArcUsdcBalance } from "./types.js";

export class InMemoryArcAdapter implements ArcAdapter {
  private readonly native = new Map<string, bigint>();
  /** EURC per USDC, 6-dec fixed point (e.g. 842910n = 0.842910). */
  usdcToEurcRate = 842_910n;

  setNativeBalance(address: `0x${string}`, wei: bigint): void {
    this.native.set(address.toLowerCase(), wei);
  }

  async getUsdcBalance(address: `0x${string}`): Promise<ArcUsdcBalance> {
    return { erc20Units: arcNativeToErc20Units(this.native.get(address.toLowerCase()) ?? 0n) };
  }

  async quoteFx(params: {
    from: "USDC" | "EURC";
    to: "USDC" | "EURC";
    amountIn: bigint;
  }): Promise<ArcFxQuote | undefined> {
    if (params.from === params.to) return undefined;
    const amountOut =
      params.from === "USDC"
        ? (params.amountIn * this.usdcToEurcRate) / 1_000_000n
        : (params.amountIn * 1_000_000n) / this.usdcToEurcRate;
    return {
      ...params,
      amountOut,
      validUntil: Math.floor(Date.now() / 1000) + 30,
      venue: "arc-stablefx",
    };
  }
}
