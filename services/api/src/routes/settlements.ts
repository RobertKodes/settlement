import { type SettlementReceipt, SettlementReceiptSchema } from "@settlement/types";
import type { FastifyInstance } from "fastify";
import { errors } from "../errors.js";
import type { ExecutionEngine } from "../execution.js";
import type { IntentRepository } from "../repos/intents.js";

/**
 * GET /v1/settlements/:intentId -> SettlementReceipt (blueprint section 10) for a SETTLED/PROVEN intent,
 * with L1 finality read live from the rollup contract. Moves SETTLED -> PROVEN when the L1 caught up.
 */
export function registerSettlementRoutes(
  app: FastifyInstance,
  deps: { intents: IntentRepository; engine?: ExecutionEngine },
): void {
  app.get<{ Params: { id: string } }>("/v1/settlements/:id", async (req) => {
    const rec = await deps.intents.get(req.params.id);
    if (!rec) throw errors.notFound("settlement");
    const st = rec.state as {
      settlementId?: string;
      txHash?: `0x${string}`;
      blockNumber?: string;
      feeBaseUnits?: string;
      settledAt?: string;
      recipient?: { accountId?: string };
      ledger?: { ledgerTransactionId: string };
    };
    if (!st.settlementId || !st.txHash) throw errors.notFound("settlement");
    const blockNumber = BigInt(st.blockNumber ?? "0");
    const fin = deps.engine
      ? await deps.engine.finality(blockNumber)
      : { state: "INCLUDED" as const };
    let current = rec;
    if (fin.state === "FINALIZED" && rec.status === "SETTLED")
      current = await deps.intents.transition(rec.intentId, "PROVEN", {
        state: { l1FinalAt: new Date().toISOString() },
      });
    const receipt: SettlementReceipt = SettlementReceiptSchema.parse({
      settlementId: st.settlementId,
      intentId: current.intentId,
      route: [{ venue: "native-transfer", shareBps: 10_000, chainId: deps.engine?.chainId }],
      transactions: [
        { chainId: deps.engine?.chainId ?? 0, txHash: st.txHash, blockNumber: Number(blockNumber) },
      ],
      legs: [
        {
          from: `acct_${current.accountId.replace(/-/g, "")}`.slice(0, 40),
          to: st.recipient?.accountId
            ? `acct_${st.recipient.accountId.replace(/-/g, "")}`.slice(0, 40)
            : "acct_external",
          amount: { ...current.intent.source, chainId: deps.engine?.chainId },
        },
      ],
      fees: { network: formatUsdc(st.feeBaseUnits ?? "0"), execution: "0", crosschain: "0" },
      createdAt: current.createdAt,
      settledAt: st.settledAt,
      softFinality: { state: "INCLUDED", l2BlockNumber: Number(blockNumber), at: st.settledAt },
      l1Finality:
        fin.state === "FINALIZED"
          ? {
              state: "FINALIZED",
              l1BlockNumber: undefined,
              at: (current.state as { l1FinalAt?: string }).l1FinalAt,
            }
          : { state: "PENDING" },
      reconciliation: st.ledger
        ? { status: "MATCHED", runId: st.ledger.ledgerTransactionId }
        : { status: "PENDING" },
    });
    return {
      ...receipt,
      status: current.status,
      finalizedL2Block: fin.finalizedL2Block?.toString(),
    };
  });
}

function formatUsdc(baseUnits: string): string {
  const n = BigInt(baseUnits);
  return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0")}`;
}
