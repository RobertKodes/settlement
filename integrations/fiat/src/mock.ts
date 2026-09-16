import type {
  CreateCustomerInput,
  FiatProvider,
  FiatQuote,
  Iso4217,
  OffRampRequest,
  OnRampRequest,
  ProviderCustomer,
  ReconcileResult,
  Transfer,
  VirtualAccount,
  WebhookVerification,
} from "./types.js";

/** Deterministic provider for tests: idempotency keys are honoured, transfers advance on `advance()`. */
export class MockFiatProvider implements FiatProvider {
  readonly name = "mock";
  private readonly customers = new Map<string, ProviderCustomer>();
  private readonly transfers = new Map<string, Transfer>();
  private readonly byIdempotency = new Map<string, string>();
  private seq = 0;
  /** Ids are unique per provider instance so several test runs against one database never collide. */
  private readonly instance = Math.random().toString(36).slice(2, 8);

  async createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer> {
    const existing = this.customers.get(input.accountId);
    if (existing) return existing;
    const c = {
      providerCustomerId: `cus_${this.instance}_${this.seq++}`,
      state: "pending" as const,
    };
    this.customers.set(input.accountId, c);
    return c;
  }

  private newTransfer(idempotencyKey: string, instructions?: Record<string, unknown>): Transfer {
    const prior = this.byIdempotency.get(idempotencyKey);
    if (prior) return this.transfers.get(prior)!;
    const t: Transfer = {
      providerTransferId: `tr_${this.instance}_${this.seq++}`,
      state: "awaiting_funds",
      updatedAt: new Date().toISOString(),
      ...(instructions ? { instructions } : {}),
    };
    this.transfers.set(t.providerTransferId, t);
    this.byIdempotency.set(idempotencyKey, t.providerTransferId);
    return t;
  }

  async createOnRamp(req: OnRampRequest): Promise<Transfer> {
    return this.newTransfer(req.idempotencyKey, {
      wireTo: { bank: "MOCK BANK", reference: req.idempotencyKey },
    });
  }
  async createOffRamp(req: OffRampRequest): Promise<Transfer> {
    return this.newTransfer(req.idempotencyKey);
  }
  async createVirtualAccount(
    providerCustomerId: string,
    currency: Iso4217,
  ): Promise<VirtualAccount> {
    return {
      providerVirtualAccountId: `va_${providerCustomerId}_${currency}`,
      currency,
      depositInstructions: { iban: "MOCK00000000000000" },
    };
  }
  async getQuote(params: {
    from: Iso4217 | "USDC" | "EURC";
    to: Iso4217 | "USDC" | "EURC";
    amountIn: string;
  }): Promise<FiatQuote> {
    return {
      ...params,
      amountOut: params.amountIn,
      fee: "0",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  async getTransferStatus(providerTransferId: string): Promise<Transfer> {
    const t = this.transfers.get(providerTransferId);
    if (!t) throw new Error(`unknown transfer ${providerTransferId}`);
    return t;
  }
  async webhookVerify(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<WebhookVerification> {
    return headers["x-mock-signature"] === `sig:${rawBody.length}`
      ? { ok: true, eventId: headers["x-mock-event-id"] ?? "" }
      : { ok: false, reason: "bad signature" };
  }
  async reconcile(): Promise<ReconcileResult> {
    const ids = [...this.transfers.keys()];
    return { providerTransferIds: ids, matched: ids.length, breaks: [] };
  }

  /** Test helper: move a transfer to the next state. */
  advance(providerTransferId: string, state: Transfer["state"]): void {
    const t = this.transfers.get(providerTransferId);
    if (!t) throw new Error(`unknown transfer ${providerTransferId}`);
    t.state = state;
    t.updatedAt = new Date().toISOString();
  }
}
