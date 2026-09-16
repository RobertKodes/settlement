import { describe, expect, it } from "vitest";
import { type ApiRequestError, Passkey, SettlementClient } from "../src/index.js";

/** Fake API that replays the real endpoint shapes so the SDK's orchestration is tested without a chain. */
function fakeApi() {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let step = 0;
  const f: typeof fetch = async (url, init) => {
    const path = String(url).replace("http://api", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path, body });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (path === "/v1/accounts")
      return json(201, {
        accountId: "11111111-1111-4111-8111-111111111111",
        handle: body.handle,
        address: "0x1111111111111111111111111111111111111111",
        chainId: 1337,
      });
    if (path === "/v1/intents")
      return json(201, { intentId: "int_abc123", status: "CREATED", state: {} });
    if (path.endsWith("/quote"))
      return json(200, {
        intentId: "int_abc123",
        status: "QUOTED",
        state: { quote: { digests: { permit: `0x${"aa".repeat(32)}` } } },
      });
    if (path.endsWith("/authorize"))
      return body.signature
        ? json(200, { intentId: "int_abc123", status: "SETTLED", state: { txHash: "0x01" } })
        : json(200, { userOpHash: `0x${"bb".repeat(32)}` });
    if (path.endsWith("/settlements/int_abc123"))
      return json(200, { settlementId: "stl_1", status: "SETTLED" });
    if (path === "/v1/accounts/missing")
      return json(404, {
        error: { code: "not_found", message: "account not found", requestId: "req_1" },
      });
    step++;
    return json(500, { error: { code: "internal_error", message: `unexpected ${path} ${step}` } });
  };
  return { f, calls };
}

describe("SettlementClient", () => {
  it("runs a transfer end to end: quote, permit signature, user-op hash, signature, execute", async () => {
    const { f, calls } = fakeApi();
    const client = new SettlementClient({ baseUrl: "http://api", fetch: f });
    const signer = new Passkey(0x5eedc0ffeen);
    const account = await client.createAccount("alice", signer);
    const result = await client.transfer(account, signer, {
      asset: "USDC",
      amount: "1000000",
      to: "bob",
    });
    expect(result.status).toBe("SETTLED");
    expect(calls.map((c) => c.path)).toEqual([
      "/v1/accounts",
      "/v1/intents",
      "/v1/intents/int_abc123/quote",
      "/v1/intents/int_abc123/authorize",
      "/v1/intents/int_abc123/authorize",
    ]);
    const last = calls.at(-1)!.body as { permitSignature: string; signature: string };
    expect(last.permitSignature).toMatch(/^0x[0-9a-f]{128}$/);
    expect(
      Passkey.verify(`0x${"bb".repeat(32)}`, last.signature as `0x${string}`, signer.publicKey()),
    ).toBe(true);
    expect((calls[1]!.body as { action: string }).action).toBe("transfer");
  });

  it("surfaces the API error envelope as a typed error", async () => {
    const { f } = fakeApi();
    const client = new SettlementClient({ baseUrl: "http://api", fetch: f });
    await expect(client.account("missing")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      requestId: "req_1",
    } satisfies Partial<ApiRequestError>);
  });
});
