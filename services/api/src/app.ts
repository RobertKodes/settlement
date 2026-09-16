import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { ApiError } from "./errors.js";
import { type IdempotencyStore, InMemoryIdempotencyStore } from "./idempotency.js";
import { InMemoryIntentRepository, type IntentRepository } from "./intents.js";
import { type ChainProbe, registerHealthRoutes } from "./routes/health.js";
import { registerIntentRoutes } from "./routes/intents.js";

export interface AppDeps {
  intents?: IntentRepository;
  idempotency?: IdempotencyStore;
  chains?: ChainProbe[];
  logger?: boolean;
}

/** Builds the Fastify app: request ids, error envelope, routes. Kept separate from `server.ts` for tests. */
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
    return reply.status(status).send({
      error: {
        code,
        message: status === 500 ? "internal error" : (e.message ?? "request failed"),
        details: {},
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

  registerHealthRoutes(app, deps.chains ?? []);
  registerIntentRoutes(app, {
    intents: deps.intents ?? new InMemoryIntentRepository(),
    idempotency: deps.idempotency ?? new InMemoryIdempotencyStore(),
  });
  return app;
}
