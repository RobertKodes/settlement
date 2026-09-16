import { loadEnv } from "@settlement/config";
import { buildApp } from "./app.js";

const env = loadEnv();
const app = buildApp({
  logger: true,
  chains: [
    { name: "l1", rpcUrl: env.L1_RPC_URL, expectedChainId: env.L1_CHAIN_ID },
    { name: "l2", rpcUrl: env.L2_RPC_URL, expectedChainId: env.L2_CHAIN_ID },
  ],
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
