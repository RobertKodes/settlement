import { z } from "zod";
import {
  AssetAmountSchema,
  AssetSymbolSchema,
  BaseUnitsSchema,
  BpsSchema,
  ChainIdSchema,
  TimestampSchema,
} from "./asset.js";
import { AccountIdSchema, IntentIdSchema } from "./ids.js";

/** Blueprint section 7: the intent engine converts a desired financial outcome into executable operations. */
export const IntentActionSchema = z.enum([
  "settle",
  "transfer",
  "swap",
  "bridge",
  "onramp",
  "offramp",
]);
export type IntentAction = z.infer<typeof IntentActionSchema>;

/** Execution venues the router may consider. "native" is this network's own liquidity. */
export const VenueSchema = z.enum(["native", "arc", "external"]);
export type Venue = z.infer<typeof VenueSchema>;

export const IntentConstraintsSchema = z.object({
  maxSlippageBps: BpsSchema.optional(),
  deadline: TimestampSchema.optional(),
  requireAtomicity: z.boolean().default(false),
  allowedVenues: z.array(VenueSchema).min(1).optional(),
});
export type IntentConstraints = z.infer<typeof IntentConstraintsSchema>;

export const IntentDestinationSchema = z.object({
  asset: AssetSymbolSchema,
  /** A product account handle (`institution-b`, `counterparty@network`), never a raw address at this layer. */
  recipient: z.string().min(1).max(128),
  chainId: ChainIdSchema.optional(),
  /** Counter-leg amount for `settle` (DvP/PvP): what the recipient pays back in `destination.asset`. */
  amount: BaseUnitsSchema.optional(),
});

/** Mirrors the section 7 example exactly; `intentId`/`accountId` are assigned by the API, not the client. */
export const IntentSchema = z.object({
  intentId: IntentIdSchema.optional(),
  accountId: AccountIdSchema.optional(),
  action: IntentActionSchema,
  source: AssetAmountSchema,
  destination: IntentDestinationSchema,
  constraints: IntentConstraintsSchema.default({ requireAtomicity: false }),
});
export type Intent = z.infer<typeof IntentSchema>;
export type IntentInput = z.input<typeof IntentSchema>;

/**
 * Section 7 lifecycle plus explicit, machine-readable failure states ("Failure states must be explicit").
 * Terminal states: RECONCILED and every FAILED_x, EXPIRED and CANCELLED.
 */
export const IntentStatusSchema = z.enum([
  "CREATED",
  "AUTHORIZED",
  "QUOTED",
  "POLICY_CHECKED",
  "ROUTE_LOCKED",
  "EXECUTING",
  "SETTLED",
  "PROVEN",
  "RECONCILED",
  "FAILED_AUTHORIZATION",
  "FAILED_QUOTE",
  "FAILED_POLICY",
  "FAILED_EXECUTION",
  "EXPIRED",
  "CANCELLED",
]);
export type IntentStatus = z.infer<typeof IntentStatusSchema>;

const FAIL_BEFORE_EXECUTION: IntentStatus[] = ["EXPIRED", "CANCELLED"];

/** Allowed forward transitions. Anything not listed is rejected by `canTransition`. */
export const INTENT_TRANSITIONS: Readonly<Record<IntentStatus, readonly IntentStatus[]>> = {
  CREATED: ["AUTHORIZED", "FAILED_AUTHORIZATION", ...FAIL_BEFORE_EXECUTION],
  AUTHORIZED: ["QUOTED", "FAILED_QUOTE", ...FAIL_BEFORE_EXECUTION],
  QUOTED: ["POLICY_CHECKED", "FAILED_POLICY", ...FAIL_BEFORE_EXECUTION],
  POLICY_CHECKED: ["ROUTE_LOCKED", "FAILED_QUOTE", ...FAIL_BEFORE_EXECUTION],
  ROUTE_LOCKED: ["EXECUTING", ...FAIL_BEFORE_EXECUTION],
  // Once executing, the only exits are settlement or an explicit execution failure: no silent cancel.
  EXECUTING: ["SETTLED", "FAILED_EXECUTION"],
  SETTLED: ["PROVEN", "RECONCILED"],
  PROVEN: ["RECONCILED"],
  RECONCILED: [],
  FAILED_AUTHORIZATION: [],
  FAILED_QUOTE: [],
  FAILED_POLICY: [],
  FAILED_EXECUTION: [],
  EXPIRED: [],
  CANCELLED: [],
};

export const TERMINAL_INTENT_STATUSES: ReadonlySet<IntentStatus> = new Set(
  (Object.keys(INTENT_TRANSITIONS) as IntentStatus[]).filter(
    (s) => INTENT_TRANSITIONS[s].length === 0,
  ),
);

export function canTransition(from: IntentStatus, to: IntentStatus): boolean {
  return INTENT_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: IntentStatus): boolean {
  return TERMINAL_INTENT_STATUSES.has(status);
}
