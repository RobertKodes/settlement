import { describe, expect, it } from "vitest";
import { CctpV2Client, toBytes32Address } from "../src/client.js";

describe("CctpV2Client (attestation API parsing)", () => {
  it("maps IRIS v2 responses to CctpMessage and treats PENDING correctly", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      const pending = calls.length === 1;
      return new Response(
        JSON.stringify({
          messages: [
            {
              status: pending ? "pending_confirmations" : "complete",
              sourceDomainId: "6",
              destinationDomainId: "26",
              eventNonce: "0xabc",
              message: "0x1234",
              attestation: pending ? "PENDING" : "0xdeadbeef",
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const c = new CctpV2Client({}, "https://iris-api-sandbox.circle.com", fetchImpl);
    const first = await c.fetchMessage(6, "0x01");
    expect(first?.status).toBe("pending_confirmations");
    const done = await c.waitForAttestation(6, "0x01", { intervalMs: 1, timeoutMs: 5_000 });
    expect(done.attestation).toBe("0xdeadbeef");
    expect(done.destinationDomain).toBe(26);
    expect(calls[0]).toBe("https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=0x01");
  });
  it("pads addresses to bytes32 for mintRecipient/destinationCaller", () => {
    expect(toBytes32Address("0x1111111111111111111111111111111111111111")).toBe(
      `0x${"00".repeat(12)}${"11".repeat(20)}`,
    );
  });
  it("refuses to burn or mint without a configured wallet", async () => {
    const c = new CctpV2Client({});
    await expect(c.receiveMessage(26, "0x", "0x")).rejects.toThrow(/not configured/);
  });
});
