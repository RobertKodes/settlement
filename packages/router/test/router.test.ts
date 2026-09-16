import { describe, expect, it } from "vitest";
import { ArcStableFxAdapter } from "../src/adapters.js";
import { SmartRouter } from "../src/router.js";
import { allInScore } from "../src/score.js";
import type { SwapRequest, VenueAdapter, VenueQuote } from "../src/types.js";

const req: SwapRequest = { chainId: 1337, from: "USDC", to: "EURC", amountIn: 1_000_000_000n };
const fake = (
  venue: string,
  family: VenueQuote["family"],
  amountOut: bigint,
  extra: Partial<VenueQuote> = {},
): VenueAdapter => ({
  family,
  quote: async () => ({
    venue,
    family,
    amountOut,
    feeBaseUnits: 0n,
    networkFeeBaseUnits: 100_000n,
    crossChainFeeBaseUnits: 0n,
    latencySeconds: 3,
    settlementCertainty: 0.999,
    executable: true,
    validUntil: 9e9,
    ...extra,
  }),
});

describe("all-in score", () => {
  it("prefers the executable venue with the better net output, not the headline rate", () => {
    const headline: VenueQuote = {
      venue: "external-x",
      family: "external",
      amountOut: 850_000_000n,
      feeBaseUnits: 0n,
      networkFeeBaseUnits: 5_000_000n,
      crossChainFeeBaseUnits: 10_000_000n,
      latencySeconds: 900,
      settlementCertainty: 0.9,
      executable: true,
      validUntil: 9e9,
    };
    const native: VenueQuote = {
      ...headline,
      venue: "native-stableswap",
      family: "native",
      amountOut: 842_000_000n,
      networkFeeBaseUnits: 100_000n,
      crossChainFeeBaseUnits: 0n,
      latencySeconds: 3,
      settlementCertainty: 0.999,
    };
    expect(allInScore(native, { latencyPenaltyPerSecond: 10n })).toBeGreaterThan(
      allInScore(headline, { latencyPenaltyPerSecond: 10n }),
    );
  });
  it("scores non-executable venues at zero", () => {
    expect(
      allInScore({
        venue: "arc-stablefx",
        family: "arc",
        amountOut: 900_000_000n,
        feeBaseUnits: 0n,
        networkFeeBaseUnits: 0n,
        crossChainFeeBaseUnits: 0n,
        latencySeconds: 1,
        settlementCertainty: 1,
        executable: false,
        validUntil: 9e9,
      }),
    ).toBe(0);
  });
});

describe("SmartRouter", () => {
  it("ranks every venue but chooses the best executable one", async () => {
    const router = new SmartRouter([
      fake("native-stableswap", "native", 842_000_000n),
      new ArcStableFxAdapter(),
    ]);
    const d = await router.route(req);
    expect(d.chosen.venue).toBe("native-stableswap");
    expect(d.ranked.map((q) => q.venue)).toContain("arc-stablefx");
    expect(d.legs).toEqual([{ venue: "native-stableswap", shareBps: 10_000, chainId: 1337 }]);
  });
  it("respects allowedVenues and fails loudly when nothing can execute", async () => {
    const router = new SmartRouter([
      fake("native-stableswap", "native", 842_000_000n),
      new ArcStableFxAdapter(),
    ]);
    await expect(router.route({ ...req, allowedVenues: ["arc"] })).rejects.toThrow(
      /no executable route/,
    );
  });
});
