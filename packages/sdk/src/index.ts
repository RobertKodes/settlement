import { Passkey } from "@settlement/chain";
import type { IntentInput, IntentStatus, SettlementReceipt } from "@settlement/types";

export { Passkey };

/** Anything that can sign a 32-byte digest for the account: the local `Passkey` in tests/tools, WebAuthn in browsers. */
export interface Signer {
  publicKey(): { qx: `0x${string}`; qy: `0x${string}` };
  sign(digest: `0x${string}`): Promise<`0x${string}`> | `0x${string}`;
}

export interface ClientOptions {
  baseUrl: string;
  /** Replace in tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Sent as X-Request-Id; helpful for support. */
  requestId?: () => string;
}

export interface AccountInfo {
  accountId: string;
  handle: string;
  address: `0x${string}`;
  chainId: number;
}

export interface IntentView {
  intentId: string;
  status: IntentStatus;
  failureCode?: string;
  state: Record<string, unknown>;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * The developer UX the blueprint asks for (section 21):
 *   const account = await client.createAccount("counterparty", signer);
 *   await client.transfer(account, signer, { asset: "USDC", amount: "100000000", to: "merchant" });
 *   await client.swap(account, signer, { from: "USDC", to: "EURC", amount: "1000000000", maxSlippageBps: 5 });
 *   await client.settle(...)   // DvP: both parties sign through their own signer
 * The SDK handles quote, digests, signing order, execution and receipt polling; the chain never leaks into the call.
 */
export class SettlementClient {
  private readonly f: typeof fetch;
  constructor(private readonly opts: ClientOptions) {
    this.f = opts.fetch ?? fetch;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await this.f(`${this.opts.baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.opts.requestId ? { "x-request-id": this.opts.requestId() } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json()) as {
      error?: { code: string; message: string; requestId?: string; details?: unknown };
    };
    if (!res.ok)
      throw new ApiRequestError(
        res.status,
        json.error?.code ?? "http_error",
        json.error?.message ?? res.statusText,
        json.error?.requestId,
        json.error?.details,
      );
    return json as T;
  }

  async createAccount(
    handle: string,
    signer: Signer,
    kind: "consumer" | "business" | "institutional" | "agent" | "service" = "business",
  ): Promise<AccountInfo> {
    return this.call("POST", "/v1/accounts", { handle, kind, passkey: signer.publicKey() });
  }

  async account(handle: string): Promise<AccountInfo> {
    return this.call("GET", `/v1/accounts/${handle}`);
  }

  async setApprovalPolicy(
    handle: string,
    thresholds: Array<{ aboveBaseUnits: string; approvals: number }>,
  ): Promise<void> {
    await this.call("POST", `/v1/accounts/${handle}/policy`, { thresholds });
  }

  async createIntent(
    account: AccountInfo,
    intent: IntentInput,
    idempotencyKey = crypto.randomUUID(),
  ): Promise<IntentView> {
    return this.call("POST", "/v1/intents", intent, {
      "idempotency-key": idempotencyKey,
      "x-account-id": account.accountId,
    });
  }

  async intent(intentId: string): Promise<IntentView> {
    return this.call("GET", `/v1/intents/${intentId}`);
  }

  /** transfer / swap: quote -> sign permit -> hash -> sign op -> execute. Resolves to the SETTLED intent. */
  private async runSingleParty(
    account: AccountInfo,
    signer: Signer,
    intent: IntentInput,
  ): Promise<IntentView> {
    const created = await this.createIntent(account, intent);
    const quoted = await this.call<IntentView>("POST", `/v1/intents/${created.intentId}/quote`);
    const draft = quoted.state.quote as { digests: { permit: `0x${string}` } };
    const permitSignature = await signer.sign(draft.digests.permit);
    const step1 = await this.call<{ userOpHash: `0x${string}` }>(
      "POST",
      `/v1/intents/${created.intentId}/authorize`,
      { permitSignature },
    );
    const signature = await signer.sign(step1.userOpHash);
    return this.call("POST", `/v1/intents/${created.intentId}/authorize`, {
      permitSignature,
      signature,
    });
  }

  transfer(
    account: AccountInfo,
    signer: Signer,
    p: { asset: "USDC"; amount: string; to: string },
  ): Promise<IntentView> {
    return this.runSingleParty(account, signer, {
      action: "transfer",
      source: { asset: p.asset, amount: p.amount },
      destination: { asset: p.asset, recipient: p.to },
    });
  }

  swap(
    account: AccountInfo,
    signer: Signer,
    p: {
      from: "USDC" | "EURC";
      to: "USDC" | "EURC";
      amount: string;
      maxSlippageBps?: number;
      allowedVenues?: ("native" | "arc" | "external")[];
    },
  ): Promise<IntentView> {
    return this.runSingleParty(account, signer, {
      action: "swap",
      source: { asset: p.from, amount: p.amount },
      destination: { asset: p.to, recipient: account.handle },
      constraints: {
        ...(p.maxSlippageBps !== undefined ? { maxSlippageBps: p.maxSlippageBps } : {}),
        ...(p.allowedVenues ? { allowedVenues: p.allowedVenues } : {}),
      },
    });
  }

  /** DvP/PvP: party A initiates; both parties sign; approvals are given out of band; then execute. */
  async settle(
    a: { account: AccountInfo; signer: Signer },
    b: { account: AccountInfo; signer: Signer },
    p: { give: { asset: string; amount: string }; receive: { asset: string; amount: string } },
    approvers: string[] = [],
  ): Promise<IntentView> {
    const created = await this.createIntent(a.account, {
      action: "settle",
      source: p.give,
      destination: {
        asset: p.receive.asset,
        recipient: b.account.handle,
        amount: p.receive.amount,
      },
      constraints: { requireAtomicity: true },
    });
    const quoted = await this.call<IntentView>("POST", `/v1/intents/${created.intentId}/quote`);
    const d = quoted.state.quote as {
      digests: { settlement: `0x${string}`; permitA: `0x${string}`; permitB: `0x${string}` };
    };
    await this.call("POST", `/v1/intents/${created.intentId}/sign`, {
      party: "A",
      signature: await a.signer.sign(d.digests.settlement),
      permit: await a.signer.sign(d.digests.permitA),
    });
    await this.call("POST", `/v1/intents/${created.intentId}/sign`, {
      party: "B",
      signature: await b.signer.sign(d.digests.settlement),
      permit: await b.signer.sign(d.digests.permitB),
    });
    for (const approver of approvers)
      await this.call("POST", `/v1/intents/${created.intentId}/approve`, { approver });
    return this.call("POST", `/v1/intents/${created.intentId}/execute`);
  }

  receipt(intentId: string): Promise<SettlementReceipt & { status: IntentStatus }> {
    return this.call("GET", `/v1/settlements/${intentId}`);
  }
}
