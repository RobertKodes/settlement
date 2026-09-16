import { z } from "zod";

/**
 * Identifiers are opaque strings with a stable prefix so a log line or a support ticket can be read
 * without a lookup: `int_…` intent, `q_…` quote (blueprint section 28), `stl_…` settlement,
 * `acct_…` product account. Product account IDs are never blockchain addresses (blueprint section 27).
 */
const prefixed = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{6,64}$`), `expected ${prefix}_<alnum>`);

export const IntentIdSchema = prefixed("int").brand<"IntentId">();
export const QuoteIdSchema = prefixed("q").brand<"QuoteId">();
export const SettlementIdSchema = prefixed("stl").brand<"SettlementId">();
export const AccountIdSchema = prefixed("acct").brand<"AccountId">();
export const ExecutionIdSchema = prefixed("exe").brand<"ExecutionId">();

export type IntentId = z.infer<typeof IntentIdSchema>;
export type QuoteId = z.infer<typeof QuoteIdSchema>;
export type SettlementId = z.infer<typeof SettlementIdSchema>;
export type AccountId = z.infer<typeof AccountIdSchema>;
export type ExecutionId = z.infer<typeof ExecutionIdSchema>;

/** 0x-prefixed, 32-byte transaction hash. */
export const TxHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x + 64 hex chars");
export type TxHash = z.infer<typeof TxHashSchema>;

/** 0x-prefixed, 20-byte EVM address (checksum not enforced here). */
export const EvmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected 0x + 40 hex chars");
export type EvmAddress = z.infer<typeof EvmAddressSchema>;
