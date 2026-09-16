/**
 * Fiat is a regulated edge, not part of the protocol (blueprint section 11, ADR-0019). The interface
 * is provider-neutral so the company is never hard-coded to one partner. The first implementation
 * targets Bridge's sandbox (see src/bridge/README.md).
 */
export type Iso4217 = "USD" | "EUR" | "GBP" | "BRL" | "MXN" | "COP";
export type Stablecoin = "USDC" | "EURC";

export type OnboardingState = "not_started" | "pending" | "approved" | "rejected" | "review";

export interface CreateCustomerInput {
  /** Our product account id; never the provider's id and never PII beyond what the provider needs. */
  accountId: string;
  type: "individual" | "business";
  /** Provider-specific KYC/KYB payload, opaque here. */
  kyc: Record<string, unknown>;
}
export interface ProviderCustomer {
  providerCustomerId: string;
  state: OnboardingState;
}

export interface OnRampRequest {
  providerCustomerId: string;
  currency: Iso4217;
  amount: string; // display decimal string, e.g. "5000000.00"
  destination: { asset: Stablecoin; chainId: number; address: `0x${string}` };
  idempotencyKey: string;
}
export interface OffRampRequest {
  providerCustomerId: string;
  source: { asset: Stablecoin; chainId: number };
  amount: string; // base units of the stablecoin
  beneficiaryId: string;
  idempotencyKey: string;
}

export type TransferState =
  | "awaiting_funds"
  | "funds_received"
  | "in_review"
  | "payment_submitted"
  | "payment_processed"
  | "returned"
  | "refunded"
  | "failed"
  | "cancelled";

export interface Transfer {
  providerTransferId: string;
  state: TransferState;
  /** Where the customer must wire fiat (on-ramp) or where funds will land (off-ramp). */
  instructions?: Record<string, unknown>;
  updatedAt: string;
}

export interface VirtualAccount {
  providerVirtualAccountId: string;
  currency: Iso4217;
  /** Bank details for inbound fiat; provider-specific (routing/account, IBAN, ...). */
  depositInstructions: Record<string, unknown>;
}

export interface FiatQuote {
  from: Iso4217 | Stablecoin;
  to: Iso4217 | Stablecoin;
  amountIn: string;
  amountOut: string;
  fee: string;
  expiresAt: string;
}

export interface WebhookVerification {
  ok: boolean;
  eventId?: string;
  reason?: string;
}

export interface ReconcileResult {
  providerTransferIds: string[];
  matched: number;
  breaks: Array<{ providerTransferId: string; reason: string }>;
}

/** Exactly the method list from blueprint section 11. */
export interface FiatProvider {
  readonly name: string;
  createCustomer(input: CreateCustomerInput): Promise<ProviderCustomer>;
  createOnRamp(req: OnRampRequest): Promise<Transfer>;
  createOffRamp(req: OffRampRequest): Promise<Transfer>;
  createVirtualAccount(providerCustomerId: string, currency: Iso4217): Promise<VirtualAccount>;
  getQuote(params: {
    from: Iso4217 | Stablecoin;
    to: Iso4217 | Stablecoin;
    amountIn: string;
  }): Promise<FiatQuote>;
  getTransferStatus(providerTransferId: string): Promise<Transfer>;
  webhookVerify(rawBody: string, headers: Record<string, string>): Promise<WebhookVerification>;
  reconcile(since: string): Promise<ReconcileResult>;
}
