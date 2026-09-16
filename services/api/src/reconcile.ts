import { testUSDCAbi } from "@settlement/contracts-abi";
import type { Address } from "viem";
import type { Db } from "./db.js";
import type { ChainDeps } from "./execution.js";

/**
 * Reconciliation (blueprint sections 12 and 20, Milestone E "reconcile"): the ledger's `available` balance per
 * (account, asset) must equal the on-chain token balance of the account's address. Every run is recorded in
 * `reconciliation_run` with the breaks; a break is a first-class alert, never silently corrected.
 */
export interface ReconciliationResult {
  runId: string;
  scope: "ledger";
  matched: number;
  breaks: Array<{
    accountId: string;
    asset: string;
    address: Address;
    ledger: string;
    chain: string;
  }>;
}

export async function reconcileLedgerVsChain(
  db: Db,
  chain: ChainDeps,
  scope: { accountId?: string } = {},
): Promise<ReconciliationResult> {
  const [run] = await db<
    { id: string }[]
  >`insert into reconciliation_run (scope) values ('ledger') returning id`;
  const rows = await db<
    {
      account_id: string;
      symbol: string;
      address: Uint8Array;
      token: Uint8Array | null;
      balance: string;
    }[]
  >`
    select la.account_id, a.symbol, ad.address, a.address as token, coalesce(sum(e.amount), 0)::text as balance
    from ledger_account la
    join asset a on a.id = la.asset_id
    join wallet w on w.account_id = la.account_id
    join address ad on ad.wallet_id = w.id and ad.chain_id = a.chain_id
    left join ledger_entry e on e.ledger_account_id = la.id
    where la.kind = 'available' and la.account_id is not null and a.chain_id = ${chain.chainId ?? 0}
      and (${scope.accountId ?? null}::uuid is null or la.account_id = ${scope.accountId ?? null}::uuid)
    group by la.account_id, a.symbol, ad.address, a.address`;
  const breaks: ReconciliationResult["breaks"] = [];
  let matched = 0;
  for (const r of rows) {
    if (!r.token) continue;
    const address = `0x${Buffer.from(r.address).toString("hex")}` as Address;
    const token = `0x${Buffer.from(r.token).toString("hex")}` as Address;
    const onChain = await chain.l2.readContract({
      address: token,
      abi: testUSDCAbi,
      functionName: "balanceOf",
      args: [address],
    });
    if (onChain.toString() === r.balance) matched++;
    else
      breaks.push({
        accountId: r.account_id,
        asset: r.symbol,
        address,
        ledger: r.balance,
        chain: onChain.toString(),
      });
  }
  await db`update reconciliation_run set finished_at = now(), status = ${breaks.length ? "breaks" : "clean"}, matched = ${matched}, breaks = ${db.json(breaks as never)} where id = ${run!.id}::uuid`;
  return { runId: run!.id, scope: "ledger", matched, breaks };
}

export function registerReconciliationRoutes(
  app: import("fastify").FastifyInstance,
  deps: { db?: Db; chain?: ChainDeps },
): void {
  app.post<{ Body: { accountId?: string } | undefined }>(
    "/v1/reconciliation/run",
    async (_req, reply) => {
      if (!deps.db || !deps.chain)
        return reply.status(422).send({
          error: {
            code: "unsupported",
            message: "reconciliation needs a database and a chain",
            details: {},
            requestId: _req.id,
          },
        });
      return reconcileLedgerVsChain(deps.db, deps.chain, {
        ...(_req.body?.accountId ? { accountId: _req.body.accountId } : {}),
      });
    },
  );
  app.get("/v1/reconciliation/runs", async (_req, reply) => {
    if (!deps.db)
      return reply.status(422).send({
        error: { code: "unsupported", message: "no database", details: {}, requestId: _req.id },
      });
    return deps.db`select id, scope, started_at, finished_at, status, matched, breaks from reconciliation_run order by started_at desc limit 20`;
  });
}
