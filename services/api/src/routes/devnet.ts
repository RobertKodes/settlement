import { testUSDCAbi } from "@settlement/contracts-abi";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "../errors.js";
import type { ExecutionEngine } from "../execution.js";
import type { AccountRepository } from "../repos/accounts.js";

const FaucetSchema = z.object({
  handle: z.string(),
  asset: z.enum(["USDC", "EURC"]),
  amountBaseUnits: z.string().regex(/^\d+$/),
});

/** POST /v1/devnet/faucet — mint test stablecoins to an account. Devnet only (chain 1337); refuses elsewhere. */
export function registerDevnetRoutes(
  app: FastifyInstance,
  deps: { accounts: AccountRepository; engine?: ExecutionEngine },
): void {
  app.post("/v1/devnet/faucet", async (req) => {
    const parsed = FaucetSchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });
    if (!deps.engine || deps.engine.chainId !== 1337)
      throw errors.unsupported("faucet exists only on the local devnet");
    const acct = await deps.accounts.byHandle(parsed.data.handle);
    if (!acct) throw errors.notFound("account");
    const chain = deps.engine.chainDeps;
    const token = parsed.data.asset === "USDC" ? chain.usdc : chain.eurc;
    if (!token) throw errors.unsupported(`${parsed.data.asset} not deployed`);
    const hash = await chain.bundler.writeContract({
      address: token,
      abi: testUSDCAbi,
      functionName: "mint",
      args: [acct.address, BigInt(parsed.data.amountBaseUnits)],
    });
    await chain.l2.waitForTransactionReceipt({ hash });
    return {
      txHash: hash,
      asset: parsed.data.asset,
      amountBaseUnits: parsed.data.amountBaseUnits,
      to: acct.address,
    };
  });
  app.get("/v1/devnet/info", async () => {
    if (!deps.engine) return { chain: null };
    const c = deps.engine.chainDeps;
    return {
      chain: {
        chainId: deps.engine.chainId,
        entryPoint: c.entryPoint,
        factory: c.factory,
        paymaster: c.paymaster,
        usdc: c.usdc,
        eurc: c.eurc,
        pool: c.pool,
        dvp: c.dvp,
        rollup: c.rollup,
      },
    };
  });
}
