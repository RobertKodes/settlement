import { describe, expect, it } from "vitest";
import { cctpLeg, curveBuyOut, curveLeg, METAPAD_CURVE, stableFxLeg } from "../src/adapters-v2.js";
import { summarize } from "../src/plan.js";
import { planRoutes } from "../src/planner.js";

describe("legs", () => {
  it("CCTP leg is BLOCKED when the Lineth rollup has no domain, executable Arc<->Base", () => {
    const blocked = cctpLeg("1", {
      asset: "USDC",
      amountIn: 1_000_000n,
      fromChainId: 1337,
      toChainId: 5042002,
      fromDomain: undefined,
      toDomain: 26,
    });
    expect(blocked.executable).toBe(false);
    expect(blocked.blockedReason).toMatch(/no CCTP domain for chain 1337/);
    const live = cctpLeg("1", {
      asset: "USDC",
      amountIn: 1_000_000n,
      fromChainId: 8453,
      toChainId: 5042002,
      fromDomain: 6,
      toDomain: 26,
    });
    expect(live.executable).toBe(true);
    expect(live.amountOut).toBe(999_900n); // 1 bps fast fee assumption
  });
  it("StableFX leg is BLOCKED without an API key, quotes with one", () => {
    expect(
      stableFxLeg("1", {
        chainId: 5042002,
        assetIn: "USDC",
        assetOut: "EURC",
        amountIn: 1_000_000n,
        indicativeRate6: 842_910n,
        apiKeyPresent: false,
      }).executable,
    ).toBe(false);
    expect(
      stableFxLeg("1", {
        chainId: 5042002,
        assetIn: "USDC",
        assetOut: "EURC",
        amountIn: 1_000_000n,
        indicativeRate6: 842_910n,
        apiKeyPresent: true,
      }).amountOut,
    ).toBe(842_910n);
  });
  it("Metapad curve math: constant product with virtual reserves, graduation caps at the curve allocation", () => {
    const state = {
      virtualQuote: 5_000n * 10n ** 6n,
      virtualTokens: METAPAD_CURVE.virtualTokens,
      soldTokens: 0n,
      raisedQuote: 0n,
      quoteDecimals: 6,
    };
    const out = curveBuyOut(state, 1_000n * 10n ** 6n);
    expect(out).toBeGreaterThan(0n);
    expect(out).toBeLessThan(METAPAD_CURVE.virtualTokens);
    const huge = curveLeg("1", {
      chainId: 5042002,
      state,
      quoteIn: 10_000_000n * 10n ** 6n,
      token: "LAUNCH",
      deployed: true,
    });
    expect(huge.amountOut).toBe(METAPAD_CURVE.onCurve);
    expect(huge.params?.graduates).toBe(true);
    expect(
      curveLeg("1", { chainId: 5042002, state, quoteIn: 1n, token: "LAUNCH", deployed: false })
        .blockedReason,
    ).toMatch(/not deployed/);
  });
});

describe("planner", () => {
  it("plans Lineth -> Arc FX with the CCTP leg BLOCKED, and reports why", async () => {
    const plans = await planRoutes(
      { cctp: { domains: { 5042002: 26 } }, arc: { stableFxApiKey: false } },
      {
        assetIn: "USDC",
        assetOut: "EURC",
        amountIn: 1_000_000_000n,
        fromChainId: 1337,
        toChainId: 5042002,
      },
    );
    const via = plans.find((p) => p.id === "via-arc-stablefx");
    expect(via).toBeDefined();
    expect(via!.executable).toBe(false);
    expect(via!.blocked.join(" | ")).toMatch(/no CCTP domain for chain 1337/);
    expect(via!.blocked.join(" | ")).toMatch(/StableFX needs an institutional API key/);
    expect(via!.legs.map((l) => l.system)).toEqual(["cctp", "arc"]);
  });
  it("marks the Arc venue BLOCKED until deployed, and StableFX as a candidate on Arc", async () => {
    const plans = await planRoutes(
      { cctp: { domains: { 5042002: 26 } } },
      {
        assetIn: "USDC",
        assetOut: "EURC",
        amountIn: 1_000_000n,
        fromChainId: 5042002,
        toChainId: 5042002,
      },
    );
    expect(plans.map((p) => p.id).sort()).toEqual(["arc-stablefx", "arc-venue"]);
    expect(plans.every((p) => !p.executable)).toBe(true);
    expect(plans.find((p) => p.id === "arc-venue")!.blocked[0]).toMatch(
      /arc contracts not deployed/,
    );
  });
  it("summarize computes end-to-end output, latency and certainty", () => {
    const s = summarize("x", [
      cctpLeg("1", {
        asset: "USDC",
        amountIn: 100n,
        fromChainId: 8453,
        toChainId: 5042002,
        fromDomain: 6,
        toDomain: 26,
      }),
      stableFxLeg("2", {
        chainId: 5042002,
        assetIn: "USDC",
        assetOut: "EURC",
        amountIn: 99n,
        indicativeRate6: 1_000_000n,
        apiKeyPresent: true,
      }),
    ]);
    expect(s.assetIn).toBe("USDC");
    expect(s.assetOut).toBe("EURC");
    expect(s.totalLatencySeconds).toBe(22);
    expect(s.certainty).toBeCloseTo(0.995 * 0.99, 5);
  });
});
