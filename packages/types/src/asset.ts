import { z } from "zod";

/**
 * Amounts are base-unit integers carried as decimal strings (ADR-0014). Never floats, never
 * display units. Decimals are a property of (asset, chain), not of the asset: Arc's native USDC has
 * 18 decimals while its ERC-20 interface has 6 (ADR-0018), so a bare "USDC" amount is meaningless
 * without the chain it lives on.
 */
export const BaseUnitsSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, "base-unit integer string");
export type BaseUnits = z.infer<typeof BaseUnitsSchema>;

/** Asset symbol as the product knows it (USDC, EURC, ETH, or an ERC-20 symbol). */
export const AssetSymbolSchema = z.string().regex(/^[A-Z0-9]{2,12}$/, "upper-case symbol");
export type AssetSymbol = z.infer<typeof AssetSymbolSchema>;

export const ChainIdSchema = z.number().int().positive();
export type ChainId = z.infer<typeof ChainIdSchema>;

export const AssetAmountSchema = z.object({
  asset: AssetSymbolSchema,
  amount: BaseUnitsSchema,
  /** Omitted when the router may pick the chain (blueprint section 5: "the user requests an outcome, not a chain"). */
  chainId: ChainIdSchema.optional(),
});
export type AssetAmount = z.infer<typeof AssetAmountSchema>;

/** Basis points, 0..10000 inclusive. */
export const BpsSchema = z.number().int().min(0).max(10_000);
export type Bps = z.infer<typeof BpsSchema>;

/** RFC 3339 timestamp with a timezone (blueprint uses `2026-09-16T18:30:00Z`). */
export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;
