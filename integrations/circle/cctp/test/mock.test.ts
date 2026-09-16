import { CCTP_DOMAINS, FinalityThreshold } from "@settlement/config";
import { describe, expect, it } from "vitest";
import { InMemoryCctpClient } from "../src/mock.js";

const base = {
  amount: 1_000_000n,
  destinationDomain: CCTP_DOMAINS.base,
  mintRecipient: `0x${"11".repeat(32)}` as const,
  burnToken: `0x${"22".repeat(20)}` as const,
  destinationCaller: `0x${"00".repeat(32)}` as const,
};

describe("InMemoryCctpClient", () => {
  it("round-trips burn -> attestation -> receive", async () => {
    const c = new InMemoryCctpClient(CCTP_DOMAINS.ethereum);
    const { txHash } = await c.depositForBurn({
      ...base,
      maxFee: 0n,
      minFinalityThreshold: FinalityThreshold.STANDARD,
    });
    const msg = await c.fetchMessage(CCTP_DOMAINS.ethereum, txHash);
    expect(msg?.status).toBe("complete");
    expect(msg?.destinationDomain).toBe(CCTP_DOMAINS.base);
    const recv = await c.receiveMessage(
      CCTP_DOMAINS.base,
      msg!.message,
      msg!.attestation as `0x${string}`,
    );
    expect(c.receipts[0]?.txHash).toBe(recv.txHash);
  });

  it("refuses a Fast transfer without a fee budget", async () => {
    const c = new InMemoryCctpClient(CCTP_DOMAINS.ethereum);
    await expect(
      c.depositForBurn({ ...base, maxFee: 0n, minFinalityThreshold: FinalityThreshold.FAST }),
    ).rejects.toThrow(/maxFee/);
  });
});
