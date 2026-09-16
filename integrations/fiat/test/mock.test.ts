import { describe, expect, it } from "vitest";
import { MockFiatProvider } from "../src/mock.js";

describe("MockFiatProvider", () => {
  it("honours idempotency keys on on-ramps", async () => {
    const p = new MockFiatProvider();
    const cus = await p.createCustomer({ accountId: "acct_1", type: "business", kyc: {} });
    const req = {
      providerCustomerId: cus.providerCustomerId,
      currency: "EUR" as const,
      amount: "100.00",
      destination: {
        asset: "EURC" as const,
        chainId: 1337,
        address: `0x${"00".repeat(20)}` as const,
      },
      idempotencyKey: "k1",
    };
    const a = await p.createOnRamp(req);
    const b = await p.createOnRamp(req);
    expect(a.providerTransferId).toBe(b.providerTransferId);
    p.advance(a.providerTransferId, "payment_processed");
    expect((await p.getTransferStatus(a.providerTransferId)).state).toBe("payment_processed");
  });
  it("rejects a bad webhook signature", async () => {
    const p = new MockFiatProvider();
    expect((await p.webhookVerify("{}", { "x-mock-signature": "nope" })).ok).toBe(false);
    expect((await p.webhookVerify("{}", { "x-mock-signature": "sig:2" })).ok).toBe(true);
  });
});
