/**
 * Arc is a peer chain, never the base of the rollup (ADR-0018). The adapter exposes Arc's USDC
 * balance and, later, StableFX/RFQ quotes to the router. Two representations of the same USDC:
 * native (gas) with 18 decimals, ERC-20 interface at 0x3600…0000 with 6 decimals.
 */
export interface ArcUsdcBalance {
  /** ERC-20 units, 6 decimals. Native balance is converted, never mixed. */
  erc20Units: bigint;
}

export interface ArcFxQuote {
  from: "USDC" | "EURC";
  to: "USDC" | "EURC";
  /** 6-decimal base units in and out. */
  amountIn: bigint;
  amountOut: bigint;
  /** Unix seconds. */
  validUntil: number;
  venue: "arc-stablefx" | "arc-rfq";
}

export interface ArcAdapter {
  getUsdcBalance(address: `0x${string}`): Promise<ArcUsdcBalance>;
  /** Undefined when no venue is reachable; the router then excludes Arc for this intent. */
  quoteFx(params: {
    from: "USDC" | "EURC";
    to: "USDC" | "EURC";
    amountIn: bigint;
  }): Promise<ArcFxQuote | undefined>;
}
