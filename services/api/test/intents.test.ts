import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const intent = {
  action: "settle",
  source: { asset: "USDC", amount: "5000000" },
  destination: { asset: "EURC", recipient: "institution-b" },
  constraints: {
    maxSlippageBps: 5,
    deadline: "2026-09-16T18:30:00Z",
    requireAtomicity: true,
    allowedVenues: ["native", "arc"],
  },
};
const headers = {
  "content-type": "application/json",
  "idempotency-key": "k-1",
};

describe("POST /v1/intents", () => {
  const app = buildApp();
  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("creates an intent with a request id and CREATED status", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/intents", headers, payload: intent });
    expect(res.statusCode).toBe(201);
    expect(res.headers["x-request-id"]).toMatch(/^req_/);
    const body = res.json();
    expect(body.status).toBe("CREATED");
    expect(body.intentId).toMatch(/^int_/);
    const got = await app.inject({ method: "GET", url: `/v1/intents/${body.intentId}` });
    expect(got.json().intent.source.amount).toBe("5000000");
  });

  it("replays the original response for the same key + payload, 409 for a different payload", async () => {
    const h = { ...headers, "idempotency-key": "k-2" };
    const a = await app.inject({ method: "POST", url: "/v1/intents", headers: h, payload: intent });
    const b = await app.inject({ method: "POST", url: "/v1/intents", headers: h, payload: intent });
    expect(b.statusCode).toBe(201);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.json().intentId).toBe(a.json().intentId);
    const c = await app.inject({
      method: "POST",
      url: "/v1/intents",
      headers: h,
      payload: { ...intent, action: "swap" },
    });
    expect(c.statusCode).toBe(409);
    expect(c.json().error.code).toBe("idempotency_conflict");
  });

  it("requires Idempotency-Key and validates the body with the error envelope", async () => {
    const noKey = await app.inject({
      method: "POST",
      url: "/v1/intents",
      headers: { "content-type": "application/json" },
      payload: intent,
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().error.code).toBe("idempotency_key_required");
    const bad = await app.inject({
      method: "POST",
      url: "/v1/intents",
      headers: { ...headers, "idempotency-key": "k-3" },
      payload: { ...intent, source: { asset: "USDC", amount: "1.5" } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatchObject({
      code: "validation_failed",
      requestId: expect.stringMatching(/^req_/),
    });
  });

  it("refuses quote and authorize without an execution chain, with stable codes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/intents",
      headers: { ...headers, "idempotency-key": "k-4" },
      payload: intent,
    });
    const id = res.json().intentId as string;
    const q = await app.inject({ method: "POST", url: `/v1/intents/${id}/quote` });
    expect(q.statusCode).toBe(422);
    expect(q.json().error.code).toBe("unsupported_intent");
    const a = await app.inject({
      method: "POST",
      url: `/v1/intents/${id}/authorize`,
      payload: { permitSignature: "0x" },
    });
    expect(a.statusCode).toBe(422);
  });

  it("echoes a supplied X-Request-Id and 404s unknown intents", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/intents/int_doesnotexist",
      headers: { "x-request-id": "req_client_1" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-request-id"]).toBe("req_client_1");
  });

  it("reports degraded health when a chain probe fails", async () => {
    const degraded = buildApp({
      chains: [{ name: "l2", rpcUrl: "http://127.0.0.1:9", expectedChainId: 1337 }],
    });
    const res = await degraded.inject({ method: "GET", url: "/v1/health" });
    expect(res.json().status).toBe("degraded");
    await degraded.close();
  });
});
