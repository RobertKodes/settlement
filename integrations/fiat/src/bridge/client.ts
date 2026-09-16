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
} from "../types.js";

/**
 * Bridge (bridge.xyz) adapter behind the FiatProvider interface (ADR-0019). Sandbox base
 * `https://api.sandbox.bridge.xyz/v0`, keys `sk-test…` granted by Bridge support. Endpoint paths follow the
 * public API docs (customers, transfers, virtual_accounts, external_accounts, webhooks). Field mappings are
 * conservative and will be tightened against the sandbox once credentials exist; until then this class is
 * exercised with a fetch mock only, and `BRIDGE_API_KEY` unset means the API keeps using MockFiatProvider.
 */
export interface BridgeConfig {
  apiKey: string;
  baseUrl?: string;
  /** Webhook public key (PEM) for signature verification; without it webhookVerify returns ok:false. */
  webhookPublicKeyPem?: string;
  fetchImpl?: typeof fetch;
}

const STATE_MAP: Record<string, Transfer["state"]> = {
  awaiting_funds: "awaiting_funds",
  funds_received: "funds_received",
  in_review: "in_review",
  payment_submitted: "payment_submitted",
  payment_processed: "payment_processed",
  returned: "returned",
  refunded: "refunded",
  error: "failed",
  canceled: "cancelled",
};

export class BridgeFiatProvider implements FiatProvider {
  readonly name = "bridge";
  private readonly base: string;
  private readonly f: typeof fetch;
  constructor(private readonly cfg: BridgeConfig) {
    this.base = cfg.baseUrl ?? "https://api.sandbox.bridge.xyz/v0";
    this.f = cfg.fetchImpl ?? fetch;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const res = await this.f(`${this.base}${path}`, {
      method,
      headers: {
        "Api-Key": this.cfg.apiKey,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok)
      throw new Error(
        `bridge ${method} ${path}: ${res.status} ${JSON.stringify(json).slice(0, 200)}`,
      );
    return json as T;
  }

  async createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer> {
    const r = await this.call<{ id: string; status: string }>(
      "POST",
      "/customers",
      { type: input.type, ...input.kyc },
      `cust-${input.accountId}`,
    );
    const state =
      (
        {
          active: "approved",
          approved: "approved",
          rejected: "rejected",
          under_review: "review",
        } as Record<string, ProviderCustomer["state"]>
      )[r.status] ?? "pending";
    return { providerCustomerId: r.id, state };
  }

  async createOnRamp(req: OnRampRequest): Promise<Transfer> {
    const r = await this.call<{
      id: string;
      state: string;
      source_deposit_instructions?: Record<string, unknown>;
    }>(
      "POST",
      "/transfers",
      {
        amount: req.amount,
        on_behalf_of: req.providerCustomerId,
        source: {
          payment_rail: req.currency === "EUR" ? "sepa" : "wire",
          currency: req.currency.toLowerCase(),
        },
        destination: {
          payment_rail: chainRail(req.destination.chainId),
          currency: req.destination.asset.toLowerCase(),
          to_address: req.destination.address,
        },
      },
      req.idempotencyKey,
    );
    return {
      providerTransferId: r.id,
      state: STATE_MAP[r.state] ?? "awaiting_funds",
      ...(r.source_deposit_instructions ? { instructions: r.source_deposit_instructions } : {}),
      updatedAt: new Date().toISOString(),
    };
  }

  async createOffRamp(req: OffRampRequest): Promise<Transfer> {
    const r = await this.call<{
      id: string;
      state: string;
      source_deposit_instructions?: Record<string, unknown>;
    }>(
      "POST",
      "/transfers",
      {
        amount: (Number(req.amount) / 1e6).toFixed(2),
        on_behalf_of: req.providerCustomerId,
        source: {
          payment_rail: chainRail(req.source.chainId),
          currency: req.source.asset.toLowerCase(),
        },
        destination: {
          payment_rail: "wire",
          currency: "usd",
          external_account_id: req.beneficiaryId,
        },
      },
      req.idempotencyKey,
    );
    return {
      providerTransferId: r.id,
      state: STATE_MAP[r.state] ?? "awaiting_funds",
      ...(r.source_deposit_instructions ? { instructions: r.source_deposit_instructions } : {}),
      updatedAt: new Date().toISOString(),
    };
  }

  async createVirtualAccount(
    providerCustomerId: string,
    currency: Iso4217,
  ): Promise<VirtualAccount> {
    const r = await this.call<{ id: string; source_deposit_instructions: Record<string, unknown> }>(
      "POST",
      `/customers/${providerCustomerId}/virtual_accounts`,
      {
        source: { currency: currency.toLowerCase() },
        destination: { payment_rail: "arbitrum", currency: "usdc" },
      },
    );
    return {
      providerVirtualAccountId: r.id,
      currency,
      depositInstructions: r.source_deposit_instructions,
    };
  }

  async getQuote(params: {
    from: Iso4217 | "USDC" | "EURC";
    to: Iso4217 | "USDC" | "EURC";
    amountIn: string;
  }): Promise<FiatQuote> {
    // Bridge prices fiat<->stablecoin at 1:1 within currency (USD<->USDC); cross-currency needs their FX endpoint (not in v0 public docs).
    if (params.from === "USD" && params.to === "USDC")
      return {
        ...params,
        amountOut: params.amountIn,
        fee: "0",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    throw new Error(`quote ${params.from}->${params.to} not supported by the Bridge adapter yet`);
  }

  async getTransferStatus(providerTransferId: string): Promise<Transfer> {
    const r = await this.call<{ id: string; state: string; updated_at?: string }>(
      "GET",
      `/transfers/${providerTransferId}`,
    );
    return {
      providerTransferId: r.id,
      state: STATE_MAP[r.state] ?? "in_review",
      updatedAt: r.updated_at ?? new Date().toISOString(),
    };
  }

  async webhookVerify(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<WebhookVerification> {
    const sig = headers["x-webhook-signature"];
    if (!sig || !this.cfg.webhookPublicKeyPem)
      return { ok: false, reason: "no signature or no public key configured" };
    // Bridge signs `${timestamp}.${body}` with RSA-SHA256; header format "t=<ts>,v0=<base64>".
    const parts = Object.fromEntries(sig.split(",").map((kv) => kv.split("=") as [string, string]));
    try {
      const { createVerify } = await import("node:crypto");
      const ok = createVerify("RSA-SHA256")
        .update(`${parts.t}.${rawBody}`)
        .end()
        .verify(this.cfg.webhookPublicKeyPem, parts.v0 ?? "", "base64");
      return ok
        ? { ok: true, eventId: (JSON.parse(rawBody) as { event_id?: string }).event_id ?? "" }
        : { ok: false, reason: "bad signature" };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  async reconcile(since: string): Promise<ReconcileResult> {
    const r = await this.call<{ data: Array<{ id: string; state: string }> }>(
      "GET",
      `/transfers?updated_after_ms=${Date.parse(since)}&limit=100`,
    );
    return { providerTransferIds: r.data.map((t) => t.id), matched: r.data.length, breaks: [] };
  }
}

function chainRail(chainId: number): string {
  return (
    (
      {
        8453: "base",
        1: "ethereum",
        42161: "arbitrum",
        137: "polygon",
        10: "optimism",
        5042: "arc",
        5042002: "arc",
      } as Record<number, string>
    )[chainId] ?? "base"
  );
}
