import { z } from "zod";
import { AssetAmountSchema, TimestampSchema } from "./asset.js";
import {
  AccountIdSchema,
  ExecutionIdSchema,
  IntentIdSchema,
  SettlementIdSchema,
  TxHashSchema,
} from "./ids.js";
import { QuoteFeesSchema, RouteLegSchema } from "./quote.js";

/** Blueprint section 10: every completed operation produces machine-readable evidence. */

export const ChainTxRefSchema = z.object({
  chainId: z.number().int().positive(),
  txHash: TxHashSchema,
  blockNumber: z.number().int().nonnegative().optional(),
});

export const SettlementLegSchema = z.object({
  /** Who gave what to whom. Account IDs, not addresses (section 27). */
  from: AccountIdSchema,
  to: AccountIdSchema,
  amount: AssetAmountSchema,
});

/** Soft finality = the sequencer included it. L1 finality = a ZK proof covering it was finalized on Ethereum. */
export const SoftFinalitySchema = z.object({
  state: z.enum(["PENDING", "INCLUDED"]),
  l2BlockNumber: z.number().int().nonnegative().optional(),
  at: TimestampSchema.optional(),
});

export const L1FinalitySchema = z.object({
  state: z.enum(["PENDING", "SUBMITTED", "FINALIZED"]),
  l1TxHash: TxHashSchema.optional(),
  l1BlockNumber: z.number().int().nonnegative().optional(),
  at: TimestampSchema.optional(),
});

export const ReconciliationStateSchema = z.object({
  status: z.enum(["PENDING", "MATCHED", "BREAK"]),
  runId: z.string().optional(),
  at: TimestampSchema.optional(),
});

export const SettlementReceiptSchema = z.object({
  settlementId: SettlementIdSchema,
  intentId: IntentIdSchema,
  executionId: ExecutionIdSchema.optional(),
  route: z.array(RouteLegSchema).min(1),
  transactions: z.array(ChainTxRefSchema).min(1),
  legs: z.array(SettlementLegSchema).min(1),
  fees: QuoteFeesSchema,
  createdAt: TimestampSchema,
  settledAt: TimestampSchema.optional(),
  softFinality: SoftFinalitySchema,
  l1Finality: L1FinalitySchema,
  reconciliation: ReconciliationStateSchema,
});
export type SettlementReceipt = z.infer<typeof SettlementReceiptSchema>;
