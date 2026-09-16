import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "../errors.js";
import { type FiatDeps, fiatToBaseUnits } from "../fiat.js";
import type { LedgerPoster } from "../ledger.js";
import type { AccountRepository } from "../repos/accounts.js";

const OnRampSchema = z.object({
  accountId: z.string().uuid(),
  currency: z.enum(["USD", "EUR", "GBP"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});
const OffRampSchema = z.object({
  accountId: z.string().uuid(),
  beneficiaryId: z.string().min(1),
  amountBaseUnits: z.string().regex(/^\d+$/),
});

/**
 * Milestone G:
 *   POST /v1/fiat/onramp   {accountId, currency, amount} -> provider transfer + bank instructions (awaiting_funds)
 *   POST /v1/fiat/offramp  {accountId, beneficiaryId, amountBaseUnits} -> provider payout after the USDC reached the treasury
 *   POST /v1/webhooks/fiat/:provider  provider events: verified, de-duplicated; payment_processed credits USDC + ledger fiat_in
 *   GET  /v1/fiat/transfers/:provider/:providerTransferId
 */
export function registerFiatRoutes(
  app: FastifyInstance,
  deps: FiatDeps & {
    accounts: AccountRepository;
    ledger?: LedgerPoster & { postFiat?: LedgerPoster["postFiat"] };
  },
): void {
  app.post("/v1/fiat/onramp", async (req, reply) => {
    const parsed = OnRampSchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !key) throw errors.missingIdempotencyKey();
    const acct = await deps.accounts.byId(parsed.data.accountId);
    if (!acct) throw errors.notFound("account");
    const customer = await deps.provider.createCustomer({
      accountId: acct.accountId,
      type: acct.kind === "consumer" ? "individual" : "business",
      kyc: {},
    });
    const quote = await deps.provider.getQuote({
      from: parsed.data.currency,
      to: "USDC",
      amountIn: parsed.data.amount,
    });
    const transfer = await deps.provider.createOnRamp({
      providerCustomerId: customer.providerCustomerId,
      currency: parsed.data.currency,
      amount: parsed.data.amount,
      destination: { asset: "USDC", chainId: acct.chainId, address: acct.address },
      idempotencyKey: key,
    });
    const rec = await deps.repo.create(
      {
        accountId: acct.accountId,
        direction: "on_ramp",
        provider: deps.provider.name,
        providerTransferId: transfer.providerTransferId,
        currency: parsed.data.currency,
        fiatAmount: parsed.data.amount,
        assetAmountBaseUnits: fiatToBaseUnits(parsed.data.amount, quote.amountOut).toString(),
        state: transfer.state,
      },
      key,
    );
    return reply.status(201).send({ ...rec, instructions: transfer.instructions, quote });
  });

  app.post("/v1/fiat/offramp", async (req, reply) => {
    const parsed = OffRampSchema.safeParse(req.body);
    if (!parsed.success) throw errors.validation({ issues: parsed.error.issues });
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !key) throw errors.missingIdempotencyKey();
    const acct = await deps.accounts.byId(parsed.data.accountId);
    if (!acct) throw errors.notFound("account");
    const customer = await deps.provider.createCustomer({
      accountId: acct.accountId,
      type: "business",
      kyc: {},
    });
    const transfer = await deps.provider.createOffRamp({
      providerCustomerId: customer.providerCustomerId,
      source: { asset: "USDC", chainId: acct.chainId },
      amount: parsed.data.amountBaseUnits,
      beneficiaryId: parsed.data.beneficiaryId,
      idempotencyKey: key,
    });
    const rec = await deps.repo.create(
      {
        accountId: acct.accountId,
        direction: "off_ramp",
        provider: deps.provider.name,
        providerTransferId: transfer.providerTransferId,
        currency: "USD",
        fiatAmount: (Number(parsed.data.amountBaseUnits) / 1e6).toFixed(2),
        assetAmountBaseUnits: parsed.data.amountBaseUnits,
        state: transfer.state,
      },
      key,
    );
    // The USDC leg is a normal transfer intent to the treasury address, authorized by the account's passkey; the
    // provider pays out once it sees the funds. Returned so the client can build that intent.
    return reply.status(201).send({
      ...rec,
      fundTreasury: {
        asset: "USDC",
        amount: parsed.data.amountBaseUnits,
        recipient: deps.chain?.bundler.account.address,
      },
    });
  });

  app.post<{ Params: { provider: string } }>("/v1/webhooks/fiat/:provider", async (req, reply) => {
    if (req.params.provider !== deps.provider.name) throw errors.notFound("provider");
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
    const verified = await deps.provider.webhookVerify(raw, headers);
    if (!verified.ok)
      throw new (await import("../errors.js")).ApiError(
        401,
        "webhook_unverified",
        verified.reason ?? "bad signature",
      );
    const event = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as {
      id: string;
      providerTransferId: string;
      state: string;
    };
    const rec = await deps.repo.byProviderId(deps.provider.name, event.providerTransferId);
    if (!rec) throw errors.notFound("fiat transfer");
    if (await deps.repo.seenEvent(rec.id, event.id))
      return reply.status(200).send({ duplicate: true, id: rec.id });
    let txHash: `0x${string}` | undefined;
    if (
      event.state === "payment_processed" &&
      rec.direction === "on_ramp" &&
      rec.state !== "payment_processed"
    ) {
      const acct = await deps.accounts.byId(rec.accountId);
      if (!acct) throw errors.notFound("account");
      if (deps.creditOnChain)
        txHash = await deps.creditOnChain(acct.address, BigInt(rec.assetAmountBaseUnits));
      if (deps.ledger?.postFiat && deps.chain)
        await deps.ledger.postFiat({
          fiatTransferId: rec.id,
          chainId: acct.chainId,
          token: deps.chain.usdc,
          accountId: rec.accountId,
          direction: "in",
          amount: BigInt(rec.assetAmountBaseUnits),
          txHash,
        });
    }
    if (
      event.state === "payment_processed" &&
      rec.direction === "off_ramp" &&
      rec.state !== "payment_processed" &&
      deps.ledger?.postFiat &&
      deps.chain
    ) {
      await deps.ledger.postFiat({
        fiatTransferId: rec.id,
        chainId: rec.direction ? (await deps.accounts.byId(rec.accountId))!.chainId : 0,
        token: deps.chain.usdc,
        accountId: rec.accountId,
        direction: "out",
        amount: BigInt(rec.assetAmountBaseUnits),
      });
    }
    const updated = await deps.repo.update(rec.id, {
      state: event.state as never,
      lastEventId: event.id,
      ...(txHash ? { txHash } : {}),
    });
    return { id: updated.id, state: updated.state, txHash };
  });

  app.get<{ Params: { provider: string; id: string } }>(
    "/v1/fiat/transfers/:provider/:id",
    async (req) => {
      const rec = await deps.repo.byProviderId(req.params.provider, req.params.id);
      if (!rec) throw errors.notFound("fiat transfer");
      const live = await deps.provider
        .getTransferStatus(rec.providerTransferId)
        .catch(() => undefined);
      return { ...rec, providerState: live?.state };
    },
  );
}
