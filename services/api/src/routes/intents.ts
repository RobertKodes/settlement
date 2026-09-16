import { type Intent, IntentSchema } from "@settlement/types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "../errors.js";
import type { ExecutionEngine, QuoteDraft } from "../execution.js";
import { fingerprint } from "../idempotency.js";
import type { LedgerPoster } from "../ledger.js";
import { type PolicyRepository, requiredApprovals } from "../policy.js";
import type { AccountRepository } from "../repos/accounts.js";
import type { AsyncIdempotencyStore } from "../repos/idempotency.js";
import type { IntentRepository } from "../repos/intents.js";
import { newPublicId } from "../repos/intents.js";
import type { SwapQuoteDraft } from "../swap.js";

const Hex = z.string().regex(/^0x([0-9a-fA-F]{2})*$/);
const AuthorizeSchema = z.object({ permitSignature: Hex, signature: Hex.optional() });

export interface IntentDeps {
  policies?: PolicyRepository;
  intents: IntentRepository;
  accounts: AccountRepository;
  idempotency: AsyncIdempotencyStore;
  engine?: ExecutionEngine;
  ledger?: LedgerPoster;
}

/**
 * POST /v1/intents                (Idempotency-Key, X-Account-Id)  -> 201 CREATED
 * GET  /v1/intents/:id
 * POST /v1/intents/:id/quote      -> QUOTED: unsigned user op + permit digest + fee bounds
 * POST /v1/intents/:id/authorize  {permitSignature} -> returns the user-op hash to sign (step 1),
 *                                 {permitSignature, signature} -> executes: EXECUTING -> SETTLED (step 2)
 * Auth is still a stub: the account comes from X-Account-Id (uuid) until the auth service exists.
 */
export function registerIntentRoutes(app: FastifyInstance, deps: IntentDeps): void {
  app.post("/v1/intents", async (req, reply) => {
    const accountId = String(req.headers["x-account-id"] ?? "");
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length === 0) throw errors.missingIdempotencyKey();
    const scope = accountId || "anon";
    const fp = fingerprint(req.body);
    const prior = await deps.idempotency.get(scope, key);
    if (prior) {
      if (prior.fingerprint !== fp) throw errors.idempotencyConflict();
      return reply.status(prior.status).header("Idempotent-Replayed", "true").send(prior.body);
    }
    const parsed = IntentSchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });
    if (accountId && !(await deps.accounts.byId(accountId))) throw errors.notFound("account");
    const rec = await deps.intents.create(
      accountId || "00000000-0000-0000-0000-000000000000",
      parsed.data,
      key,
    );
    await deps.idempotency.put(scope, key, {
      fingerprint: fp,
      status: 201,
      body: rec,
      storedAt: Date.now(),
    });
    return reply.status(201).send(rec);
  });

  app.get<{ Params: { id: string } }>("/v1/intents/:id", async (req) => {
    const rec = await deps.intents.get(req.params.id);
    if (!rec) throw errors.notFound("intent");
    return rec;
  });

  app.post<{ Params: { id: string } }>("/v1/intents/:id/quote", async (req) => {
    const rec = await deps.intents.get(req.params.id);
    if (!rec) throw errors.notFound("intent");
    if (!deps.engine) throw errors.unsupported("no execution chain configured");
    const sender = await deps.accounts.byId(rec.accountId);
    if (!sender) throw errors.notFound("sender account");
    let draft: QuoteDraft;
    let recipient: { address: `0x${string}`; accountId?: string };
    try {
      recipient = await deps.engine.resolveRecipient(rec.intent, (h) => deps.accounts.byHandle(h));
      if (rec.intent.action === "settle") {
        if (!deps.engine.settleDeps) throw new Error("DvP settlement contract not configured");
        const partyB = recipient.accountId
          ? await deps.accounts.byId(recipient.accountId)
          : undefined;
        if (!partyB) throw new Error("settle counterparty must be an account handle");
        const { quoteSettle } = await import("../settle.js");
        draft = (await quoteSettle(
          deps.engine.settleDeps,
          rec.intent,
          sender,
          partyB,
          deps.engine.chainId,
          rec.intentId,
        )) as unknown as QuoteDraft;
      } else {
        draft = await deps.engine.quote(rec.intent, sender, recipient.address);
      }
    } catch (e) {
      await deps.intents
        .transition(rec.intentId, rec.status === "CREATED" ? "AUTHORIZED" : rec.status)
        .catch(() => undefined);
      await deps.intents.transition(rec.intentId, "FAILED_QUOTE", {
        failureCode: "quote_failed",
        state: { error: (e as Error).message },
      });
      throw errors.unsupported((e as Error).message);
    }
    // CREATED -> AUTHORIZED is implicit today (the caller owns the account); the passkey signature is the real authorization.
    const authorized =
      rec.status === "CREATED" ? await deps.intents.transition(rec.intentId, "AUTHORIZED") : rec;
    const quoteId = newPublicId("q");
    return deps.intents.transition(authorized.intentId, "QUOTED", {
      state: { quoteId, quote: draft, recipient },
    });
  });

  app.post<{ Params: { id: string } }>("/v1/intents/:id/authorize", async (req, reply) => {
    const parsed = AuthorizeSchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });
    const rec = await deps.intents.get(req.params.id);
    if (!rec) throw errors.notFound("intent");
    if (!deps.engine) throw errors.unsupported("no execution chain configured");
    const draft = rec.state.quote as QuoteDraft | undefined;
    if (!draft || rec.status !== "QUOTED") throw errors.illegalTransition(rec.status, "EXECUTING");
    if (new Date(draft.expiresAt).getTime() < Date.now())
      throw errors.conflict("quote expired; request a new quote");

    const { op, hash } = await deps.engine.userOpHash(
      draft,
      parsed.data.permitSignature as `0x${string}`,
    );
    if (!parsed.data.signature)
      return reply
        .status(200)
        .send({ intentId: rec.intentId, userOpHash: hash, status: rec.status });

    op.signature = parsed.data.signature as `0x${string}`;
    // Policy: the sender's approval thresholds on the source amount (blueprint section 6).
    const required = deps.policies
      ? requiredApprovals(
          await deps.policies.getApprovalPolicy(rec.accountId),
          BigInt(rec.intent.source.amount),
        )
      : 0;
    const approvals = deps.policies ? await deps.policies.approvals(rec.intentId) : [];
    if (approvals.length < required) {
      await deps.intents.transition(rec.intentId, "FAILED_POLICY", {
        failureCode: "approvals_missing",
        state: { required, approvals },
      });
      throw errors.policyDenied(`${required} approval(s) required, ${approvals.length} given`, {
        required,
        approvals,
      });
    }
    const checked = await deps.intents.transition(rec.intentId, "POLICY_CHECKED", {
      state: { required, approvals },
    });
    const locked = await deps.intents.transition(checked.intentId, "ROUTE_LOCKED", {
      state: { userOpHash: hash },
    });
    const executing = await deps.intents.transition(locked.intentId, "EXECUTING");
    try {
      const sender = (await deps.accounts.byId(rec.accountId))!;
      const recipient = rec.state.recipient as { address: `0x${string}`; accountId?: string };
      const amount = BigInt(rec.intent.source.amount);
      const isSwap = rec.intent.action === "swap";
      const swapDraft = draft as SwapQuoteDraft;
      const tokenOut = isSwap
        ? rec.intent.destination.asset === "USDC"
          ? deps.engine.tokens.usdc
          : deps.engine.tokens.eurc
        : undefined;
      const result = await deps.engine.execute(op, sender.address, amount, tokenOut);
      let ledgerRef: { ledgerTransactionId: string; chainTransactionId: string } | undefined;
      if (deps.ledger) {
        ledgerRef = isSwap
          ? await deps.ledger.postSwap({
              intentId: rec.intentId,
              chainId: deps.engine.chainId,
              tokenIn:
                tokenOf(op) === deps.engine.tokens.usdc && rec.intent.source.asset === "USDC"
                  ? deps.engine.tokens.usdc
                  : deps.engine.tokens.eurc!,
              symbolIn: rec.intent.source.asset,
              tokenOut: tokenOut!,
              symbolOut: rec.intent.destination.asset,
              account: rec.accountId,
              amountIn: amount,
              amountOut: result.receivedBaseUnits,
              fee: result.feeBaseUnits,
              feeToken: deps.engine.tokens.usdc,
              feeSymbol: "USDC",
              txHash: result.txHash,
              blockNumber: result.blockNumber,
            })
          : await deps.ledger.postTransfer({
              intentId: rec.intentId,
              chainId: deps.engine.chainId,
              token: tokenOf(op),
              symbol: "USDC",
              decimals: 6,
              from: rec.accountId,
              to: recipient.accountId,
              amount,
              fee: result.feeBaseUnits,
              txHash: result.txHash,
              blockNumber: result.blockNumber,
            });
      }
      const settlementId = newPublicId("stl");
      const settled = await deps.intents.transition(executing.intentId, "SETTLED", {
        state: {
          settlementId,
          txHash: result.txHash,
          blockNumber: result.blockNumber.toString(),
          userOpHash: result.userOpHash,
          feeBaseUnits: result.feeBaseUnits.toString(),
          receivedBaseUnits: result.receivedBaseUnits.toString(),
          route: isSwap
            ? swapDraft.route
            : [{ venue: "native-transfer", shareBps: 10_000, chainId: deps.engine.chainId }],
          settledAt: new Date().toISOString(),
          ledger: ledgerRef,
        },
      });
      return settled;
    } catch (e) {
      await deps.intents.transition(executing.intentId, "FAILED_EXECUTION", {
        failureCode: "execution_reverted",
        state: { error: (e as Error).message },
      });
      throw errors.executionFailed((e as Error).message);
    }
  });
}

/** Token address from the paymasterAndData layout (offset 53..73). */
function tokenOf(op: { paymasterAndData: `0x${string}` }): `0x${string}` {
  return `0x${op.paymasterAndData.slice(2 + 53 * 2, 2 + 73 * 2)}` as `0x${string}`;
}

export type { Intent };
