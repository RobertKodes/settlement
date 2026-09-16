import type { Passkey } from "@settlement/chain";

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly err: ApiError,
  ) {
    super(
      `${err.code}: ${err.message}${(err.details as { cause?: string })?.cause ? ` (${(err.details as { cause: string }).cause})` : ""}`,
    );
  }
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: ApiError };
  if (!res.ok)
    throw new RequestError(
      res.status,
      json.error ?? { code: "http_error", message: res.statusText },
    );
  return json as T;
}

export interface Account {
  accountId: string;
  handle: string;
  address: `0x${string}`;
  chainId: number;
  kind: string;
}
export interface IntentView {
  intentId: string;
  accountId: string;
  status: string;
  failureCode?: string;
  intent: {
    action: string;
    source: { asset: string; amount: string };
    destination: { asset: string; recipient: string; amount?: string };
    constraints?: Record<string, unknown>;
  };
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface PortfolioLine {
  group: string;
  asset: string;
  amount: string;
  decimals: number;
  provenance: {
    source: string;
    chainId?: number;
    address?: string;
    contract?: string;
    ledger?: string;
    agrees?: boolean;
    asOf: string;
    detail?: string;
  };
}
export interface Portfolio {
  account: Account;
  lines: PortfolioLine[];
  totals: { byGroup: Record<string, string>; net: string; rates: Record<string, string> };
  reconciliation: { status: string; at?: string };
}
export interface Receipt {
  settlementId: string;
  intentId: string;
  status: string;
  route: Array<{ venue: string; shareBps: number }>;
  transactions: Array<{ chainId: number; txHash: string; blockNumber?: number }>;
  legs: Array<{ from: string; to: string; amount: { asset: string; amount: string } }>;
  fees: { network: string; execution: string; crosschain: string };
  createdAt: string;
  settledAt?: string;
  softFinality: { state: string; l2BlockNumber?: number; at?: string };
  l1Finality: { state: string; at?: string };
  reconciliation: { status: string; runId?: string };
  finalizedL2Block?: string;
}

export interface SystemsView {
  lineth: {
    chainId?: number;
    entryPoint: string;
    dvp?: string;
    venueRouter?: string;
    pool?: string;
  } | null;
  arc: {
    chainId: number;
    rpc: string;
    usdc: string;
    eurc: string;
    deployments: Record<string, string> | null;
    stableFx: string;
    cctpDomain: number;
  } | null;
  blocked: string[];
}
export interface PlanView {
  id: string;
  executable: boolean;
  blocked: string[];
  score: number;
  amountOut: string;
  totalLatencySeconds: number;
  certainty: number;
  legs: Array<{
    id: string;
    system: string;
    kind: string;
    venue?: string;
    chainId?: number;
    assetIn: string;
    assetOut: string;
    amountIn: string;
    amountOut: string;
    executable: boolean;
    blockedReason?: string;
    latencySeconds: number;
  }>;
}

export const api = {
  systems: () => call<SystemsView>("GET", "/v1/systems"),
  plan: (p: {
    assetIn: string;
    assetOut: string;
    amountIn: string;
    fromChainId: number;
    toChainId: number;
  }) => call<PlanView[]>("POST", "/v1/routes/plan", p),
  health: () =>
    call<{
      status: string;
      chains: Array<{ name: string; ok: boolean; chainId?: number; block?: string }>;
    }>("GET", "/v1/health"),
  devnet: () => call<{ chain: Record<string, unknown> | null }>("GET", "/v1/devnet/info"),
  createAccount: (handle: string, kind: string, passkey: Passkey) =>
    call<Account>("POST", "/v1/accounts", { handle, kind, passkey: passkey.publicKey() }),
  account: (handle: string) => call<Account>("GET", `/v1/accounts/${handle}`),
  portfolio: (handle: string) => call<Portfolio>("GET", `/v1/accounts/${handle}/portfolio`),
  intents: (handle: string) => call<IntentView[]>("GET", `/v1/accounts/${handle}/intents?limit=40`),
  intent: (id: string) => call<IntentView>("GET", `/v1/intents/${id}`),
  receipt: (id: string) => call<Receipt>("GET", `/v1/settlements/${id}`),
  faucet: (handle: string, asset: "USDC" | "EURC", amountBaseUnits: string) =>
    call<{ txHash: string }>("POST", "/v1/devnet/faucet", { handle, asset, amountBaseUnits }),
  setPolicy: (handle: string, thresholds: Array<{ aboveBaseUnits: string; approvals: number }>) =>
    call("POST", `/v1/accounts/${handle}/policy`, { thresholds }),
  createIntent: (account: Account, intent: unknown) =>
    call<IntentView>("POST", "/v1/intents", intent, {
      "idempotency-key": crypto.randomUUID(),
      "x-account-id": account.accountId,
    }),
  quote: (id: string) => call<IntentView>("POST", `/v1/intents/${id}/quote`),
  authorize1: (id: string, permitSignature: string) =>
    call<{ userOpHash: `0x${string}` }>("POST", `/v1/intents/${id}/authorize`, { permitSignature }),
  authorize2: (id: string, permitSignature: string, signature: string) =>
    call<IntentView>("POST", `/v1/intents/${id}/authorize`, { permitSignature, signature }),
  sign: (id: string, party: "A" | "B", signature: string, permit: string) =>
    call<{ signed: string[] }>("POST", `/v1/intents/${id}/sign`, { party, signature, permit }),
  approve: (id: string, approver: string) =>
    call<{ approvals: string[]; required: number }>("POST", `/v1/intents/${id}/approve`, {
      approver,
    }),
  execute: (id: string) => call<IntentView>("POST", `/v1/intents/${id}/execute`),
  reconcile: (accountId?: string) =>
    call<{ runId: string; matched: number; breaks: unknown[] }>(
      "POST",
      "/v1/reconciliation/run",
      accountId ? { accountId } : {},
    ),
};

export const STAGES = [
  "CREATED",
  "AUTHORIZED",
  "QUOTED",
  "POLICY_CHECKED",
  "ROUTE_LOCKED",
  "EXECUTING",
  "SETTLED",
  "PROVEN",
  "RECONCILED",
] as const;
export function stageIndex(status: string): number {
  const i = STAGES.indexOf(status as (typeof STAGES)[number]);
  if (i >= 0) return i;
  if (status.startsWith("FAILED_") || status === "EXPIRED" || status === "CANCELLED") return -1;
  return 0;
}
