import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "../errors.js";
import type { ExecutionEngine } from "../execution.js";
import type { AccountRepository } from "../repos/accounts.js";

const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const CreateAccountSchema = z.object({
  handle: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  kind: z.enum(["consumer", "business", "institutional", "agent", "service"]).default("consumer"),
  passkey: z.object({ qx: Hex32, qy: Hex32, salt: Hex32.default(`0x${"00".repeat(32)}`) }),
});

/**
 * POST /v1/accounts  {handle, kind, passkey:{qx,qy,salt}} -> 201 account with its counterfactual L2 address
 * GET  /v1/accounts/:handle
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  deps: { accounts: AccountRepository; engine?: ExecutionEngine },
): void {
  app.post("/v1/accounts", async (req, reply) => {
    const parsed = CreateAccountSchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });
    if (!deps.engine) throw errors.unsupported("no execution chain configured");
    const { handle, kind, passkey } = parsed.data;
    const address = await deps.engine.deployAccount(
      passkey.qx as `0x${string}`,
      passkey.qy as `0x${string}`,
      passkey.salt as `0x${string}`,
    );
    const rec = await deps.accounts.create({
      handle,
      kind,
      chainId: deps.engine.chainId,
      address,
      signer: passkey as { qx: `0x${string}`; qy: `0x${string}`; salt: `0x${string}` },
    });
    return reply.status(201).send(rec);
  });

  app.get<{ Params: { handle: string } }>("/v1/accounts/:handle", async (req) => {
    const rec = await deps.accounts.byHandle(req.params.handle);
    if (!rec) throw errors.notFound("account");
    return rec;
  });
}
