import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "../errors.js";
import type { ExecutionEngine } from "../execution.js";
import type { LedgerPoster } from "../ledger.js";
import { type ApprovalPolicy, type PolicyRepository, requiredApprovals } from "../policy.js";
import type { AccountRepository } from "../repos/accounts.js";
import type { IntentRepository } from "../repos/intents.js";
import { newPublicId } from "../repos/intents.js";
import type { SignatureRepository } from "../repos/signatures.js";
import { executeSettle, type SettleQuoteDraft } from "../settle.js";

const Hex = z.string().regex(/^0x([0-9a-fA-F]{2})*$/);
const SignSchema = z.object({ party: z.enum(["A", "B"]), signature: Hex, permit: Hex.optional() });
const ApproveSchema = z.object({ approver: z.string().min(1).max(128) });
const PolicySchema = z.object({
  thresholds: z
    .array(
      z.object({
        aboveBaseUnits: z.string().regex(/^\d+$/),
        approvals: z.number().int().min(1).max(10),
      }),
    )
    .max(10),
});

export interface SettleDeps {
  intents: IntentRepository;
  accounts: AccountRepository;
  policies: PolicyRepository;
  signatures: SignatureRepository;
  engine?: ExecutionEngine;
  ledger?: LedgerPoster;
}

/**
 * Milestone F (blueprint sections 6 and 10):
 *   POST /v1/accounts/:handle/policy      set the approval thresholds of an account
 *   POST /v1/intents/:id/quote            (settle action) -> DvP digests for both parties, QUOTED
 *   POST /v1/intents/:id/sign             {party, signature, permit?} each party's authorization
 *   POST /v1/intents/:id/approve          {approver} an approval towards the policy of the paying accounts
 *   POST /v1/intents/:id/execute          when both signatures and every required approval are in: atomic settlement
 */
export function registerSettleRoutes(app: FastifyInstance, deps: SettleDeps): void {
  app.post<{ Params: { handle: string } }>("/v1/accounts/:handle/policy", async (req, reply) => {
    const parsed = PolicySchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });
    const acct = await deps.accounts.byHandle(req.params.handle);
    if (!acct) throw errors.notFound("account");
    await deps.policies.setApprovalPolicy(acct.accountId, parsed.data as ApprovalPolicy);
    return reply.status(200).send({ accountId: acct.accountId, policy: parsed.data });
  });

  app.post<{ Params: { id: string } }>("/v1/intents/:id/sign", async (req) => {
    const parsed = SignSchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });
    const rec = await deps.intents.get(req.params.id);
    if (rec?.intent.action !== "settle") throw errors.notFound("settle intent");
    if (rec.status !== "QUOTED") throw errors.illegalTransition(rec.status, "AUTHORIZED");
    await deps.signatures.put(rec.intentId, {
      party: parsed.data.party,
      signature: parsed.data.signature as `0x${string}`,
      ...(parsed.data.permit ? { permit: parsed.data.permit as `0x${string}` } : {}),
    });
    const have = await deps.signatures.get(rec.intentId);
    return { intentId: rec.intentId, signed: Object.keys(have).sort(), status: rec.status };
  });

  app.post<{ Params: { id: string } }>("/v1/intents/:id/approve", async (req) => {
    const parsed = ApproveSchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });
    const rec = await deps.intents.get(req.params.id);
    if (!rec) throw errors.notFound("intent");
    const draftForApproval = rec.state.quote as SettleQuoteDraft | undefined;
    const candidates = [
      rec.accountId,
      ...(draftForApproval?.parties?.B ? [draftForApproval.parties.B.accountId] : []),
    ];
    let approvals: string[];
    try {
      approvals = await deps.policies.addApproval(rec.intentId, candidates, parsed.data.approver);
    } catch (e) {
      throw errors.conflict((e as Error).message);
    }
    return { intentId: rec.intentId, approvals, required: await requiredFor(deps, rec.intentId) };
  });

  app.post<{ Params: { id: string } }>("/v1/intents/:id/execute", async (req) => {
    const rec = await deps.intents.get(req.params.id);
    if (rec?.intent.action !== "settle") throw errors.notFound("settle intent");
    if (!deps.engine?.settleDeps)
      throw errors.unsupported("DvP settlement contract not configured");
    const draft = rec.state.quote as SettleQuoteDraft | undefined;
    if (!draft || rec.status !== "QUOTED") throw errors.illegalTransition(rec.status, "EXECUTING");
    const sigs = await deps.signatures.get(rec.intentId);
    if (!sigs.A || !sigs.B)
      throw errors.conflict(`missing signatures from party ${!sigs.A ? "A" : "B"}`);
    const required = await requiredFor(deps, rec.intentId);
    const approvals = await deps.policies.approvals(rec.intentId);
    if (approvals.length < required) {
      // Not terminal: the intent waits in the approval queue (status stays QUOTED with both signatures kept).
      throw errors.policyDenied(`${required} approval(s) required, ${approvals.length} given`, {
        required,
        approvals,
        awaiting: "approvals",
      });
    }
    const checked = await deps.intents.transition(rec.intentId, "POLICY_CHECKED", {
      state: { required, approvals },
    });
    const locked = await deps.intents.transition(checked.intentId, "ROUTE_LOCKED");
    const executing = await deps.intents.transition(locked.intentId, "EXECUTING");
    try {
      const result = await executeSettle(
        deps.engine.settleDeps,
        draft,
        sigs.A.signature,
        sigs.B.signature,
        sigs.A.permit ?? "0x",
        sigs.B.permit ?? "0x",
      );
      const s = draft.settlement;
      const ledger = deps.ledger
        ? await deps.ledger.postSettlement({
            intentId: rec.intentId,
            chainId: deps.engine.chainId,
            accountA: draft.parties.A.accountId,
            accountB: draft.parties.B.accountId,
            tokenA: s.legA.token,
            symbolA: rec.intent.source.asset,
            amountA: BigInt(s.legA.amount),
            tokenB: s.legB.token,
            symbolB: rec.intent.destination.asset,
            amountB: BigInt(s.legB.amount),
            txHash: result.txHash,
            blockNumber: result.blockNumber,
          })
        : undefined;
      return deps.intents.transition(executing.intentId, "SETTLED", {
        state: {
          settlementId: newPublicId("stl"),
          txHash: result.txHash,
          blockNumber: result.blockNumber.toString(),
          settlementHash: result.settlementHash,
          feeBaseUnits: "0",
          route: [{ venue: "native-dvp", shareBps: 10_000, chainId: deps.engine.chainId }],
          settledAt: new Date().toISOString(),
          ledger,
        },
      });
    } catch (e) {
      await deps.intents.transition(executing.intentId, "FAILED_EXECUTION", {
        failureCode: "settlement_reverted",
        state: { error: (e as Error).message },
      });
      throw errors.executionFailed((e as Error).message);
    }
  });
}

/** Approvals required = max over both paying accounts' policies for the amount each one pays. */
async function requiredFor(deps: SettleDeps, intentId: string): Promise<number> {
  const rec = await deps.intents.get(intentId);
  if (!rec) return 0;
  const draft = rec.state.quote as SettleQuoteDraft | undefined;
  const a = await deps.policies.getApprovalPolicy(rec.accountId);
  let required = requiredApprovals(a, BigInt(rec.intent.source.amount));
  if (draft?.parties.B && rec.intent.destination.amount) {
    const b = await deps.policies.getApprovalPolicy(draft.parties.B.accountId);
    required = Math.max(required, requiredApprovals(b, BigInt(rec.intent.destination.amount)));
  }
  return required;
}
