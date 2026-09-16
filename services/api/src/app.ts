import { randomUUID } from "node:crypto";
import { type FiatProvider, MockFiatProvider } from "@settlement/integration-fiat";
import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { ApiError } from "./errors.js";
import type { ExecutionEngine } from "./execution.js";
import { devnetCredit, type FiatRepository, InMemoryFiatRepository } from "./fiat.js";
import { InMemoryIdempotencyStore } from "./idempotency.js";
import type { LedgerPoster } from "./ledger.js";
import { InMemoryPolicyRepository, type PolicyRepository } from "./policy.js";
import { registerReconciliationRoutes } from "./reconcile.js";
import { type AccountRepository, InMemoryAccountRepository } from "./repos/accounts.js";
import { type AsyncIdempotencyStore, asAsync } from "./repos/idempotency.js";
import { InMemoryIntentRepository, type IntentRepository } from "./repos/intents.js";
import { InMemorySignatureRepository, type SignatureRepository } from "./repos/signatures.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerFiatRoutes } from "./routes/fiat.js";
import { type ChainProbe, registerHealthRoutes } from "./routes/health.js";
import { registerIntentRoutes } from "./routes/intents.js";
import { registerSettleRoutes } from "./routes/settle.js";
import { registerSettlementRoutes } from "./routes/settlements.js";

export interface AppDeps {
  intents?: IntentRepository;
  accounts?: AccountRepository;
  idempotency?: AsyncIdempotencyStore;
  engine?: ExecutionEngine;
  ledger?: LedgerPoster;
  policies?: PolicyRepository;
  signatures?: SignatureRepository;
  fiat?: { provider: FiatProvider; repo: FiatRepository };
  db?: Db;
  chains?: ChainProbe[];
  logger?: boolean;
}

/** Builds the Fastify app: request ids, error envelope, routes. In-memory repositories by default (tests). */
export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? false,
    genReqId: (req) =>
      typeof req.headers["x-request-id"] === "string"
        ? req.headers["x-request-id"]
        : `req_${randomUUID()}`,
    requestIdHeader: false,
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Request-Id", req.id);
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? {},
          requestId: req.id,
        },
      });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    const status = typeof e.statusCode === "number" ? e.statusCode : 500;
    const code = status === 500 ? "internal_error" : (e.code ?? "request_error");
    req.log.error(err);
    // Outside production the cause is surfaced so integration tests and local debugging see it.
    const details =
      status === 500 && process.env.NODE_ENV !== "production"
        ? { cause: e.message ?? String(err) }
        : {};
    return reply.status(status).send({
      error: {
        code,
        message: status === 500 ? "internal error" : (e.message ?? "request failed"),
        details,
        requestId: req.id,
      },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: {
        code: "not_found",
        message: `${req.method} ${req.url} not found`,
        details: {},
        requestId: req.id,
      },
    });
  });

  const intents = deps.intents ?? new InMemoryIntentRepository();
  const accounts = deps.accounts ?? new InMemoryAccountRepository();
  const idempotency = deps.idempotency ?? asAsync(new InMemoryIdempotencyStore());
  const policies = deps.policies ?? new InMemoryPolicyRepository();
  const signatures = deps.signatures ?? new InMemorySignatureRepository();
  registerHealthRoutes(app, deps.chains ?? []);
  registerAccountRoutes(app, { accounts, ...(deps.engine ? { engine: deps.engine } : {}) });
  registerIntentRoutes(app, {
    intents,
    accounts,
    idempotency,
    policies,
    ...(deps.engine ? { engine: deps.engine } : {}),
    ...(deps.ledger ? { ledger: deps.ledger } : {}),
  });
  registerSettlementRoutes(app, { intents, ...(deps.engine ? { engine: deps.engine } : {}) });
  const fiat = deps.fiat ?? {
    provider: new MockFiatProvider(),
    repo: new InMemoryFiatRepository(),
  };
  registerFiatRoutes(app, {
    ...fiat,
    accounts,
    ...(deps.engine
      ? { chain: deps.engine.chainDeps, creditOnChain: devnetCredit(deps.engine.chainDeps) }
      : {}),
    ...(deps.ledger ? { ledger: deps.ledger } : {}),
  });
  registerReconciliationRoutes(app, {
    ...(deps.db ? { db: deps.db } : {}),
    ...(deps.engine ? { chain: deps.engine.chainDeps } : {}),
  });
  registerSettleRoutes(app, {
    intents,
    accounts,
    policies,
    signatures,
    ...(deps.engine ? { engine: deps.engine } : {}),
    ...(deps.ledger ? { ledger: deps.ledger } : {}),
  });
  return app;
}
