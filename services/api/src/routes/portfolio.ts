import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { errors } from "../errors.js";
import type { ExecutionEngine } from "../execution.js";
import { buildPortfolio } from "../portfolio.js";
import type { AccountRepository } from "../repos/accounts.js";

/**
 * GET /v1/accounts/:handle/portfolio  unified account with provenance per line (Phase H)
 * GET /v1/accounts/:handle/intents    the account's intents, newest first (Settlement Terminal feed)
 */
export function registerPortfolioRoutes(
  app: FastifyInstance,
  deps: { accounts: AccountRepository; engine?: ExecutionEngine; db?: Db },
): void {
  app.get<{ Params: { handle: string } }>("/v1/accounts/:handle/portfolio", async (req) => {
    const acct = await deps.accounts.byHandle(req.params.handle);
    if (!acct) throw errors.notFound("account");
    if (!deps.engine) throw errors.unsupported("no chain configured");
    return buildPortfolio(
      { chain: deps.engine.chainDeps, ...(deps.db ? { db: deps.db } : {}) },
      acct,
    );
  });

  app.get<{ Params: { handle: string }; Querystring: { limit?: string } }>(
    "/v1/accounts/:handle/intents",
    async (req) => {
      const acct = await deps.accounts.byHandle(req.params.handle);
      if (!acct) throw errors.notFound("account");
      if (!deps.db) return [];
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const rows = await deps.db<
        {
          public_id: string;
          status: string;
          failure_code: string | null;
          body: Record<string, unknown>;
          created_at: Date;
          updated_at: Date;
        }[]
      >`
      select public_id, status, failure_code, body, created_at, updated_at from intent where account_id = ${acct.accountId}::uuid order by created_at desc limit ${limit}`;
      return rows.map((r) => {
        const { state, ...intent } = r.body as { state?: Record<string, unknown> } & Record<
          string,
          unknown
        >;
        return {
          intentId: r.public_id,
          accountId: acct.accountId,
          status: r.status,
          ...(r.failure_code ? { failureCode: r.failure_code } : {}),
          intent,
          state: state ?? {},
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        };
      });
    },
  );
}
