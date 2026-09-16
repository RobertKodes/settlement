import { describe, expect, it } from "vitest";
import { arcErc20ToNativeUnits, arcNativeToErc20Units, hasDust } from "../src/decimals.js";
import { InMemoryArcAdapter } from "../src/mock.js";

describe("Arc decimals", () => {
  it("converts 1 USDC both ways", () => {
    expect(arcNativeToErc20Units(1_000_000_000_000_000_000n)).toBe(1_000_000n);
    expect(arcErc20ToNativeUnits(1_000_000n)).toBe(1_000_000_000_000_000_000n);
  });
  it("flags sub-microdollar dust", () => {
    expect(hasDust(1_000_000_000_000n)).toBe(false);
    expect(hasDust(1_000_000_000_001n)).toBe(true);
    expect(arcNativeToErc20Units(1_999_999_999_999n)).toBe(1n);
  });
  it("adapter reports ERC-20 units from a native balance", async () => {
    const a = new InMemoryArcAdapter();
    a.setNativeBalance(`0x${"ab".repeat(20)}`, 5n * 10n ** 18n);
    expect((await a.getUsdcBalance(`0x${"AB".repeat(20)}`)).erc20Units).toBe(5_000_000n);
    expect((await a.quoteFx({ from: "USDC", to: "EURC", amountIn: 1_000_000n }))?.amountOut).toBe(
      842_910n,
    );
  });
});
