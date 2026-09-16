import { IntentSchema } from "@settlement/types";
import type { FastifyInstance } from "fastify";
import { errors } from "../errors.js";
import { fingerprint, type IdempotencyStore } from "../idempotency.js";
import type { IntentRepository } from "../intents.js";

/**
 * POST /v1/intents  (Idempotency-Key required)   -> 201 IntentRecord
 * GET  /v1/intents/:id                           -> 200 IntentRecord
 * Auth is a stub until Phase 2's account service: the account is taken from `X-Account-Id`.
 */
export function registerIntentRoutes(
  app: FastifyInstance,
  deps: { intents: IntentRepository; idempotency: IdempotencyStore },
): void {
  app.post("/v1/intents", async (req, reply) => {
    const accountId = String(req.headers["x-account-id"] ?? "acct_anonymous");
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length === 0) throw errors.missingIdempotencyKey();

    const fp = fingerprint(req.body);
    const prior = deps.idempotency.get(accountId, key);
    if (prior) {
      if (prior.fingerprint !== fp) throw errors.idempotencyConflict();
      return reply.status(prior.status).header("Idempotent-Replayed", "true").send(prior.body);
    }

    const parsed = IntentSchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });

    const rec = deps.intents.create(accountId, parsed.data);
    deps.idempotency.put(accountId, key, {
      fingerprint: fp,
      status: 201,
      body: rec,
      storedAt: Date.now(),
    });
    return reply.status(201).send(rec);
  });

  app.get<{ Params: { id: string } }>("/v1/intents/:id", async (req) => {
    const rec = deps.intents.get(req.params.id);
    if (!rec) throw errors.notFound("intent");
    return rec;
  });
}
