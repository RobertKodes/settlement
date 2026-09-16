import { stableSwapPoolAbi, testUSDCAbi } from "@settlement/contracts-abi";
import type { Address } from "viem";
import type { Db } from "./db.js";
import type { ChainDeps } from "./execution.js";
import type { AccountRecord } from "./repos/accounts.js";

/**
 * Unified Account (Phase H): one view, many sources, every line carries its provenance. Nothing is summed
 * into a fake single ledger balance: each line says where the number came from and how fresh it is.
 */
export interface PortfolioLine {
  group: "fiat" | "stablecoins" | "digital-assets" | "positions" | "pending";
  asset: string;
  /** Base units as a decimal string; `decimals` says how to display. */
  amount: string;
  decimals: number;
  /** Where the number comes from and whether two sources agree. */
  provenance: {
    source: "chain" | "ledger" | "fiat-provider" | "pool" | "intent";
    chainId?: number;
    address?: Address;
    contract?: Address;
    ledger?: string; // ledger `available` for the same asset, when it exists
    agrees?: boolean; // chain == ledger
    asOf: string;
    detail?: string;
  };
}

export interface Portfolio {
  account: { accountId: string; handle: string; address: Address; chainId: number };
  lines: PortfolioLine[];
  /** USD-equivalent totals per group and overall, with the rates used (devnet stub rates). */
  totals: { byGroup: Record<string, string>; net: string; rates: Record<string, string> };
  reconciliation: { source: string; status: "clean" | "breaks" | "unknown"; at?: string };
}

const RATES: Record<string, number> = { USDC: 1, EURC: 1.1865, ETH: 4000, USD: 1, EUR: 1.1865 };

export async function buildPortfolio(
  deps: { db?: Db; chain: ChainDeps },
  acct: AccountRecord,
): Promise<Portfolio> {
  const { chain, db } = deps;
  const now = new Date().toISOString();
  const lines: PortfolioLine[] = [];
  const ledgerAvail = new Map<string, string>();
  if (db) {
    const rows = await db<{ symbol: string; balance: string }[]>`
      select a.symbol, coalesce(sum(e.amount),0)::text as balance
      from ledger_account la join asset a on a.id = la.asset_id left join ledger_entry e on e.ledger_account_id = la.id
      where la.account_id = ${acct.accountId}::uuid and la.kind = 'available' group by a.symbol`;
    for (const r of rows) ledgerAvail.set(r.symbol, r.balance);
  }
  const tokens: Array<[string, Address | undefined]> = [
    ["USDC", chain.usdc],
    ["EURC", chain.eurc],
  ];
  for (const [symbol, token] of tokens) {
    if (!token) continue;
    const bal = await chain.l2.readContract({
      address: token,
      abi: testUSDCAbi,
      functionName: "balanceOf",
      args: [acct.address],
    });
    const ledger = ledgerAvail.get(symbol);
    lines.push({
      group: "stablecoins",
      asset: symbol,
      amount: bal.toString(),
      decimals: 6,
      provenance: {
        source: "chain",
        chainId: acct.chainId,
        address: acct.address,
        contract: token,
        ...(ledger !== undefined ? { ledger, agrees: ledger === bal.toString() } : {}),
        asOf: now,
      },
    });
  }
  const eth = await chain.l2.getBalance({ address: acct.address });
  lines.push({
    group: "digital-assets",
    asset: "ETH",
    amount: eth.toString(),
    decimals: 18,
    provenance: {
      source: "chain",
      chainId: acct.chainId,
      address: acct.address,
      asOf: now,
      detail: "gas is paid in USDC; ETH is not required",
    },
  });
  if (chain.pool) {
    const [lp, supply, d] = await Promise.all([
      chain.l2.readContract({
        address: chain.pool,
        abi: stableSwapPoolAbi,
        functionName: "balanceOf",
        args: [acct.address],
      }),
      chain.l2.readContract({
        address: chain.pool,
        abi: stableSwapPoolAbi,
        functionName: "totalSupply",
      }),
      chain.l2.readContract({ address: chain.pool, abi: stableSwapPoolAbi, functionName: "getD" }),
    ]);
    if (lp > 0n && supply > 0n) {
      const value = (d * lp) / supply; // 18-dec value of the LP share
      lines.push({
        group: "positions",
        asset: "USDC/EURC LP",
        amount: (value / 10n ** 12n).toString(),
        decimals: 6,
        provenance: {
          source: "pool",
          chainId: acct.chainId,
          contract: chain.pool,
          asOf: now,
          detail: `${lp} LP of ${supply}`,
        },
      });
    }
  }
  if (db) {
    const fiat = await db<
      { fiat_currency: string; state: string; fiat_amount: string; direction: string }[]
    >`
      select fiat_currency, state, fiat_amount::text, direction from fiat_transfer where account_id = ${acct.accountId}::uuid and state not in ('payment_processed','returned','refunded','failed','cancelled')`;
    for (const f of fiat) {
      const units = BigInt(Math.round(Number(f.fiat_amount) * 100));
      lines.push({
        group: "fiat",
        asset: f.fiat_currency,
        amount: units.toString(),
        decimals: 2,
        provenance: { source: "fiat-provider", asOf: now, detail: `${f.direction} ${f.state}` },
      });
    }
    const pending = await db<
      {
        public_id: string;
        action: string;
        status: string;
        body: { source: { asset: string; amount: string } };
      }[]
    >`
      select public_id, action, status, body from intent where account_id = ${acct.accountId}::uuid and status in ('CREATED','AUTHORIZED','QUOTED','POLICY_CHECKED','ROUTE_LOCKED','EXECUTING')`;
    for (const p of pending)
      lines.push({
        group: "pending",
        asset: p.body.source.asset,
        amount: p.body.source.amount,
        decimals: 6,
        provenance: {
          source: "intent",
          asOf: now,
          detail: `${p.public_id} ${p.action} ${p.status}`,
        },
      });
  }
  const byGroup: Record<string, number> = {};
  let net = 0;
  for (const l of lines) {
    if (l.group === "pending") continue;
    const rate = RATES[l.asset.split("/")[0] ?? l.asset] ?? (l.group === "positions" ? 1 : 0);
    const usd = (Number(l.amount) / 10 ** l.decimals) * rate;
    byGroup[l.group] = (byGroup[l.group] ?? 0) + usd;
    net += usd;
  }
  let reconciliation: Portfolio["reconciliation"] = {
    source: "reconciliation_run",
    status: "unknown",
  };
  if (db) {
    const [run] = await db<
      { status: string; finished_at: Date | null }[]
    >`select status, finished_at from reconciliation_run where scope = 'ledger' order by started_at desc limit 1`;
    if (run)
      reconciliation = {
        source: "reconciliation_run",
        status: run.status === "clean" ? "clean" : run.status === "breaks" ? "breaks" : "unknown",
        ...(run.finished_at ? { at: run.finished_at.toISOString() } : {}),
      };
  }
  return {
    account: {
      accountId: acct.accountId,
      handle: acct.handle,
      address: acct.address,
      chainId: acct.chainId,
    },
    lines,
    totals: {
      byGroup: Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, v.toFixed(2)])),
      net: net.toFixed(2),
      rates: Object.fromEntries(Object.entries(RATES).map(([k, v]) => [k, String(v)])),
    },
    reconciliation,
  };
}
