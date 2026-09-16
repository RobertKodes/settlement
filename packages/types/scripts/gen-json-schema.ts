// Writes JSON Schema for the public wire types into schema/. Committed so non-TS consumers (API docs,
// other languages) get the same contract. Run: pnpm gen:schema (also part of `build`).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { IntentSchema } from "../src/intent.js";
import { QuoteSchema } from "../src/quote.js";
import { SettlementReceiptSchema } from "../src/settlement-receipt.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
mkdirSync(outDir, { recursive: true });

const targets = {
  intent: IntentSchema,
  quote: QuoteSchema,
  "settlement-receipt": SettlementReceiptSchema,
} as const;

for (const [name, schema] of Object.entries(targets)) {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  });
  const withId = { $id: `https://schemas.settlement.local/${name}.schema.json`, ...json };
  writeFileSync(join(outDir, `${name}.schema.json`), `${JSON.stringify(withId, null, 2)}\n`);
  console.log(`wrote schema/${name}.schema.json`);
}
