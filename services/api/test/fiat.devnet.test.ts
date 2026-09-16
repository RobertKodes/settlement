/** Milestone G on the devnet with the mock provider: on-ramp -> webhook -> USDC credited + ledger; off-ramp; reconciliation. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Passkey } from "@settlement/chain";
import { testUSDCAbi } from "@settlement/contracts-abi";
import { MockFiatProvider } from "@settlement/integration-fiat";
import { parseUnits } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { connect, reachable } from "../src/db.js";
import { devnetChainDeps } from "../src/devnet.js";
import { ExecutionEngine } from "../src/execution.js";
import { PgFiatRepository } from "../src/fiat.js";
import { PgLedgerPoster } from "../src/ledger.js";
import { PgAccountRepository } from "../src/repos/accounts.js";
import { PgIdempotencyStore } from "../src/repos/idempotency.js";
import { PgIntentRepository } from "../src/repos/intents.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://settlement:settlement@localhost:5439/settlement";
const chain = process.env.DEVNET === "1" ? devnetChainDeps(repoRoot) : undefined;
const enabled = !!chain && (await reachable(DATABASE_URL));

describe.skipIf(!enabled)("devnet fiat: on-ramp, off-ramp, reconciliation", () => {
  const db = connect(DATABASE_URL);
  const engine = new ExecutionEngine(chain!);
  const provider = new MockFiatProvider();
  const usdcAssetId = async () =>
    (
      await db<
        { id: string }[]
      >`insert into asset (symbol, chain_id, address, decimals, kind) values ('USDC', 1337, ${Buffer.from(chain!.usdc.slice(2), "hex")}, 6, 'stablecoin') on conflict (chain_id, symbol, address) do update set decimals = excluded.decimals returning id`
    )[0]!.id;
  const app = buildApp({
    intents: new PgIntentRepository(db),
    accounts: new PgAccountRepository(db),
    idempotency: new PgIdempotencyStore(db),
    ledger: new PgLedgerPoster(db),
    engine,
    db,
    fiat: { provider, repo: new PgFiatRepository(db, usdcAssetId) },
  });
  beforeAll(() => app.ready());
  afterAll(async () => {
    await app.close();
    await db.end({ timeout: 2 });
  });

  it("credits USDC after the provider confirms the bank payment, exactly once, and reconciles clean", async () => {
    const run = `${Date.now().toString(36)}f`;
    const k = Passkey.random();
    const acct = (
      await app.inject({
        method: "POST",
        url: "/v1/accounts",
        payload: { handle: `dana-${run}`, kind: "business", passkey: k.publicKey() },
      })
    ).json() as { accountId: string; address: `0x${string}` };

    const on = await app.inject({
      method: "POST",
      url: "/v1/fiat/onramp",
      headers: { "idempotency-key": `on-${run}` },
      payload: { accountId: acct.accountId, currency: "USD", amount: "1500.25" },
    });
    expect(on.statusCode, on.body).toBe(201);
    const rec = on.json() as {
      providerTransferId: string;
      state: string;
      instructions: unknown;
      assetAmountBaseUnits: string;
    };
    expect(rec.state).toBe("awaiting_funds");
    expect(rec.instructions).toBeTruthy();
    expect(rec.assetAmountBaseUnits).toBe(parseUnits("1500.25", 6).toString());

    // the bank pays: provider advances the transfer and calls our webhook (mock signature = sig:<body length>)
    provider.advance(rec.providerTransferId, "payment_processed");
    const body = JSON.stringify({
      id: `evt-${run}`,
      providerTransferId: rec.providerTransferId,
      state: "payment_processed",
    });
    const hook = {
      method: "POST" as const,
      url: "/v1/webhooks/fiat/mock",
      headers: {
        "content-type": "application/json",
        "x-mock-signature": `sig:${body.length}`,
        "x-mock-event-id": `evt-${run}`,
      },
      payload: body,
    };
    const first = await app.inject(hook);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().txHash).toMatch(/^0x/);
    const dup = await app.inject(hook);
    expect(dup.json().duplicate).toBe(true);
    expect(
      await chain!.l2.readContract({
        address: chain!.usdc,
        abi: testUSDCAbi,
        functionName: "balanceOf",
        args: [acct.address],
      }),
    ).toBe(parseUnits("1500.25", 6));
    const bad = await app.inject({
      ...hook,
      headers: { ...hook.headers, "x-mock-signature": "sig:0" },
    });
    expect(bad.statusCode).toBe(401);

    const status = await app.inject({
      method: "GET",
      url: `/v1/fiat/transfers/mock/${rec.providerTransferId}`,
    });
    expect(status.json().state).toBe("payment_processed");

    // off-ramp request: the client then moves USDC to the treasury with a normal transfer intent
    const off = await app.inject({
      method: "POST",
      url: "/v1/fiat/offramp",
      headers: { "idempotency-key": `off-${run}` },
      payload: {
        accountId: acct.accountId,
        beneficiaryId: "ben_1",
        amountBaseUnits: parseUnits("500", 6).toString(),
      },
    });
    expect(off.statusCode, off.body).toBe(201);
    expect(off.json().fundTreasury.recipient).toBe(chain!.bundler.account.address);

    // scoped to this account: ledger (fiat_in 1500.25) must equal the chain balance
    const recon = await app.inject({
      method: "POST",
      url: "/v1/reconciliation/run",
      payload: { accountId: acct.accountId },
    });
    expect(recon.statusCode, recon.body).toBe(200);
    const r = recon.json() as { matched: number; breaks: unknown[] };
    expect(r.breaks).toEqual([]);
    expect(r.matched).toBe(1);
    // a global run reports the breaks other tests caused by minting outside the ledger, and records the run
    const all = (await app.inject({ method: "POST", url: "/v1/reconciliation/run" })).json() as {
      runId: string;
      breaks: unknown[];
    };
    const runs = (
      await app.inject({ method: "GET", url: "/v1/reconciliation/runs" })
    ).json() as Array<{ id: string; status: string }>;
    expect(runs.map((x) => x.id)).toContain(all.runId);
    console.log(
      `fiat on-ramp ${rec.providerTransferId} credited; reconciliation matched ${r.matched} balances, breaks ${r.breaks.length}`,
    );
  }, 180_000);
});
