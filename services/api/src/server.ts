import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@settlement/config";
import { MockFiatProvider } from "@settlement/integration-fiat";
import { buildApp } from "./app.js";
import { connect } from "./db.js";
import { devnetChainDeps } from "./devnet.js";
import { ExecutionEngine } from "./execution.js";
import { PgFiatRepository } from "./fiat.js";
import { PgLedgerPoster } from "./ledger.js";
import { PgPolicyRepository } from "./policy.js";
import { PgAccountRepository } from "./repos/accounts.js";
import { PgIdempotencyStore } from "./repos/idempotency.js";
import { PgIntentRepository } from "./repos/intents.js";
import { PgSignatureRepository } from "./repos/signatures.js";

const env = loadEnv();

async function usdcAssetId(database: typeof db, token?: `0x${string}`): Promise<string> {
  const [row] = await database<
    { id: string }[]
  >`insert into asset (symbol, chain_id, address, decimals, kind) values ('USDC', ${env.L2_CHAIN_ID}, ${token ? Buffer.from(token.slice(2), "hex") : null}, 6, 'stablecoin') on conflict (chain_id, symbol, address) do update set decimals = excluded.decimals returning id`;
  return row!.id;
}
const db = connect(env.DATABASE_URL);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const chain = devnetChainDeps(repoRoot, {
  L1_RPC_URL: env.L1_RPC_URL,
  L2_RPC_URL: env.L2_RPC_URL,
  ...(process.env.BUNDLER_PRIVATE_KEY
    ? { BUNDLER_PRIVATE_KEY: process.env.BUNDLER_PRIVATE_KEY }
    : {}),
});

const app = buildApp({
  logger: true,
  intents: new PgIntentRepository(db),
  accounts: new PgAccountRepository(db),
  idempotency: new PgIdempotencyStore(db),
  ledger: new PgLedgerPoster(db),
  policies: new PgPolicyRepository(db),
  db,
  // Fiat provider: the mock until Bridge sandbox credentials exist (ADR-0019); swap the class, keep the routes.
  fiat: {
    provider: new MockFiatProvider(),
    repo: new PgFiatRepository(db, () => usdcAssetId(db, chain?.usdc)),
  },
  signatures: new PgSignatureRepository(db),
  ...(chain ? { engine: new ExecutionEngine(chain) } : {}),
  chains: [
    { name: "l1", rpcUrl: env.L1_RPC_URL, expectedChainId: env.L1_CHAIN_ID },
    { name: "l2", rpcUrl: env.L2_RPC_URL, expectedChainId: env.L2_CHAIN_ID },
  ],
});
app.log.info(
  { execution: chain ? `devnet (${chain.entryPoint})` : "disabled" },
  "execution engine",
);

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
