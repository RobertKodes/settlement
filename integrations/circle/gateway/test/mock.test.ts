import { CCTP_DOMAINS } from "@settlement/config";
import { describe, expect, it } from "vitest";
import { InMemoryGatewayClient } from "../src/mock.js";

const depositor = `0x${"01".repeat(20)}` as const;
const intent = {
  sourceDomain: CCTP_DOMAINS.ethereum,
  destinationDomain: CCTP_DOMAINS.arc,
  depositor,
  recipient: depositor,
  destinationCaller: `0x${"00".repeat(20)}` as const,
  amount: 500n,
  maxFee: 1n,
  validUntil: 1_800_000_000,
  salt: `0x${"00".repeat(32)}` as const,
};

describe("InMemoryGatewayClient", () => {
  it("debits the unified balance on burn and records the mint", async () => {
    const gw = new InMemoryGatewayClient();
    gw.deposit(depositor, CCTP_DOMAINS.ethereum, 1000n);
    const [att] = await gw.submitBurnIntents([{ intent, signature: "0x00" }]);
    expect((await gw.getBalances(depositor, [CCTP_DOMAINS.ethereum]))[0]?.available).toBe(499n);
    await gw.mint(att!);
    expect(gw.mints).toHaveLength(1);
  });
  it("rejects more than 16 intents per request", async () => {
    const gw = new InMemoryGatewayClient();
    await expect(
      gw.submitBurnIntents(Array(17).fill({ intent, signature: "0x00" })),
    ).rejects.toThrow(/16/);
  });
  it("serialises bigints in the typed data message", () => {
    expect(new InMemoryGatewayClient().buildBurnIntent(intent).message.amount).toBe("500");
  });
});
