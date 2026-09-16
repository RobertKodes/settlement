import { z } from "zod";
import { AssetAmountSchema, BpsSchema, TimestampSchema } from "./asset.js";
import { QuoteIdSchema } from "./ids.js";

/** Named execution venues as the router reports them (blueprint section 28 example). */
export const RouteLegSchema = z.object({
  /** e.g. "native-stableswap", "native-clamm", "arc-rfq", "external-<name>". */
  venue: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case venue id"),
  shareBps: BpsSchema,
  /** Optional: which chain this leg executes on, when it differs from the intent's source chain. */
  chainId: z.number().int().positive().optional(),
});
export type RouteLeg = z.infer<typeof RouteLegSchema>;

/** Fees in the *input* asset's display units as decimal strings (section 28: "network": "4.12"). */
const DisplayDecimal = z.string().regex(/^\d+(\.\d+)?$/, "decimal string");

export const QuoteFeesSchema = z.object({
  network: DisplayDecimal,
  execution: DisplayDecimal,
  crosschain: DisplayDecimal,
});

export const QuoteSchema = z
  .object({
    quoteId: QuoteIdSchema,
    input: AssetAmountSchema,
    output: AssetAmountSchema,
    route: z.array(RouteLegSchema).min(1),
    fees: QuoteFeesSchema,
    expiresAt: TimestampSchema,
    /** Section 8: the all-in score the router ranked this quote by; higher is better. Opaque to clients. */
    executionScore: z.number().finite().optional(),
  })
  .refine((q) => q.route.reduce((acc, leg) => acc + leg.shareBps, 0) === 10_000, {
    message: "route shares must sum to 10000 bps",
    path: ["route"],
  });
export type Quote = z.infer<typeof QuoteSchema>;
