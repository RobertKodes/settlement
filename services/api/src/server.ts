import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@settlement/config";
import { buildApp } from "./app.js";
import { connect } from "./db.js";
import { devnetChainDeps } from "./devnet.js";
import { ExecutionEngine } from "./execution.js";
import { PgLedgerPoster } from "./ledger.js";
import { PgAccountRepository } from "./repos/accounts.js";
import { PgIdempotencyStore } from "./repos/idempotency.js";
import { PgIntentRepository } from "./repos/intents.js";

const env = loadEnv();
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
