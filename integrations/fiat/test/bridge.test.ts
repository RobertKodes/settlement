import { describe, expect, it } from "vitest";
import { BridgeFiatProvider } from "../src/bridge/client.js";

function fakeBridge() {
  const calls: Array<{
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: unknown;
  }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = url.replace("https://api.sandbox.bridge.xyz/v0", "");
    calls.push({
      method: init?.method ?? "GET",
      path,
      headers: Object.fromEntries(Object.entries(init?.headers ?? {})),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (path === "/customers") return json({ id: "cust_1", status: "active" });
    if (path === "/transfers")
      return json({
        id: "tr_1",
        state: "awaiting_funds",
        source_deposit_instructions: { bank_name: "Lead Bank", routing: "1" },
      });
    if (path === "/transfers/tr_1") return json({ id: "tr_1", state: "payment_processed" });
    return json({ code: "not_found" }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("BridgeFiatProvider", () => {
  it("sends the API key, idempotency keys and the documented transfer shape", async () => {
    const { fetchImpl, calls } = fakeBridge();
    const b = new BridgeFiatProvider({ apiKey: "sk-test-x", fetchImpl });
    const c = await b.createCustomer({
      accountId: "a1",
      type: "business",
      kyc: { business_name: "ACME" },
    });
    expect(c).toEqual({ providerCustomerId: "cust_1", state: "approved" });
    const t = await b.createOnRamp({
      providerCustomerId: c.providerCustomerId,
      currency: "USD",
      amount: "1000.00",
      destination: { asset: "USDC", chainId: 5042002, address: `0x${"11".repeat(20)}` },
      idempotencyKey: "k1",
    });
    expect(t.state).toBe("awaiting_funds");
    expect(t.instructions).toMatchObject({ bank_name: "Lead Bank" });
    expect(calls[1]!.headers["Api-Key"]).toBe("sk-test-x");
    expect(calls[1]!.headers["Idempotency-Key"]).toBe("k1");
    expect(calls[1]!.body).toMatchObject({
      amount: "1000.00",
      destination: { payment_rail: "arc", currency: "usdc" },
    });
    expect((await b.getTransferStatus("tr_1")).state).toBe("payment_processed");
  });
  it("refuses webhooks without a configured public key", async () => {
    const b = new BridgeFiatProvider({ apiKey: "sk-test-x", fetchImpl: fakeBridge().fetchImpl });
    expect((await b.webhookVerify("{}", { "x-webhook-signature": "t=1,v0=abc" })).ok).toBe(false);
  });
});
