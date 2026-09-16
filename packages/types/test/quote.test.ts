import { describe, expect, it } from "vitest";
import { QuoteSchema } from "../src/quote.js";
import { SettlementReceiptSchema } from "../src/settlement-receipt.js";

// Blueprint section 28 example (venue names neutralised).
const quote = {
  quoteId: "q_123abc",
  input: { asset: "USDC", amount: "1000000" },
  output: { asset: "EURC", amount: "842910" },
  route: [
    { venue: "native-stableswap", shareBps: 6500 },
    { venue: "arc-rfq", shareBps: 3500 },
  ],
  fees: { network: "4.12", execution: "18.00", crosschain: "0.00" },
  expiresAt: "2026-09-16T18:30:00Z",
};

describe("QuoteSchema", () => {
  it("accepts the blueprint example", () => {
    expect(QuoteSchema.parse(quote).route).toHaveLength(2);
  });
  it("rejects route shares that do not sum to 10000", () => {
    expect(() =>
      QuoteSchema.parse({ ...quote, route: [{ venue: "native-stableswap", shareBps: 9000 }] }),
    ).toThrow(/10000/);
  });
});

describe("SettlementReceiptSchema", () => {
  it("accepts a fully finalized receipt", () => {
    const receipt = SettlementReceiptSchema.parse({
      settlementId: "stl_0000001",
      intentId: "int_0000001",
      route: quote.route,
      transactions: [{ chainId: 1337, txHash: `0x${"ab".repeat(32)}`, blockNumber: 42 }],
      legs: [
        {
          from: "acct_aaaaaa",
          to: "acct_bbbbbb",
          amount: { asset: "USDC", amount: "1000000", chainId: 1337 },
        },
      ],
      fees: quote.fees,
      createdAt: "2026-09-16T18:00:00Z",
      settledAt: "2026-09-16T18:00:05Z",
      softFinality: { state: "INCLUDED", l2BlockNumber: 42 },
      l1Finality: { state: "FINALIZED", l1TxHash: `0x${"cd".repeat(32)}`, l1BlockNumber: 9000 },
      reconciliation: { status: "MATCHED", runId: "rec-2026-09-16" },
    });
    expect(receipt.l1Finality.state).toBe("FINALIZED");
  });
});
