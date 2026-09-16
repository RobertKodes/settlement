/**
 * End-to-end product flow against the local devnet + local Postgres:
 * account (passkey) -> intent -> quote -> sign permit + user op with the passkey -> authorize -> SETTLED
 * -> ledger posted -> settlement receipt with finality. Run: pnpm test:devnet (DEVNET=1). Skipped otherwise.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Passkey } from "@settlement/chain";
import { testUSDCAbi } from "@settlement/contracts-abi";
import { parseUnits } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { connect, reachable } from "../src/db.js";
import { devnetChainDeps } from "../src/devnet.js";
import { ExecutionEngine } from "../src/execution.js";
import { PgLedgerPoster } from "../src/ledger.js";
import { PgPolicyRepository } from "../src/policy.js";
import { PgAccountRepository } from "../src/repos/accounts.js";
import { PgIdempotencyStore } from "../src/repos/idempotency.js";
import { PgIntentRepository } from "../src/repos/intents.js";
import { PgSignatureRepository } from "../src/repos/signatures.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://settlement:settlement@localhost:5439/settlement";
const chain = process.env.DEVNET === "1" ? devnetChainDeps(repoRoot) : undefined;
const enabled = !!chain && (await reachable(DATABASE_URL));

describe.skipIf(!enabled)(
  "devnet flow: account -> intent -> quote -> authorize -> settled -> receipt",
  () => {
    const db = connect(DATABASE_URL);
    const engine = new ExecutionEngine(chain!);
    const app = buildApp({
      intents: new PgIntentRepository(db),
      accounts: new PgAccountRepository(db),
      idempotency: new PgIdempotencyStore(db),
      ledger: new PgLedgerPoster(db),
      engine,
    });
    beforeAll(() => app.ready());
    afterAll(async () => {
      await app.close();
      await db.end({ timeout: 2 });
    });

    it("settles a USDC transfer paid in USDC and posts a balanced ledger transaction", async () => {
      const run = Date.now().toString(36);
      const alice = Passkey.random();
      const bob = Passkey.random();
      const mk = async (handle: string, k: Passkey) => {
        const res = await app.inject({
          method: "POST",
          url: "/v1/accounts",
          payload: { handle, kind: "business", passkey: k.publicKey() },
        });
        expect(res.statusCode, res.body).toBe(201);
        return res.json() as { accountId: string; address: `0x${string}` };
      };
      const a = await mk(`alice-${run}`, alice);
      const b = await mk(`bob-${run}`, bob);

      // fund Alice's counterfactual account with test USDC (deployer owns TestUSDC)
      const mint = await chain!.bundler.writeContract({
        address: chain!.usdc,
        abi: testUSDCAbi,
        functionName: "mint",
        args: [a.address, parseUnits("1000", 6)],
      });
      await chain!.l2.waitForTransactionReceipt({ hash: mint });

      const created = await app.inject({
        method: "POST",
        url: "/v1/intents",
        headers: { "idempotency-key": `k-${run}`, "x-account-id": a.accountId },
        payload: {
          action: "transfer",
          source: { asset: "USDC", amount: parseUnits("250", 6).toString() },
          destination: { asset: "USDC", recipient: `bob-${run}` },
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const intentId = created.json().intentId as string;

      const quoted = await app.inject({ method: "POST", url: `/v1/intents/${intentId}/quote` });
      expect(quoted.statusCode, quoted.body).toBe(200);
      expect(quoted.json().status).toBe("QUOTED");
      const draft = quoted.json().state.quote as {
        digests: { permit: `0x${string}` };
        fee: { maxBaseUnits: string };
      };
      expect(BigInt(draft.fee.maxBaseUnits)).toBeGreaterThan(0n);

      const permitSignature = alice.sign(draft.digests.permit);
      const step1 = await app.inject({
        method: "POST",
        url: `/v1/intents/${intentId}/authorize`,
        payload: { permitSignature },
      });
      expect(step1.statusCode, step1.body).toBe(200);
      const userOpHash = step1.json().userOpHash as `0x${string}`;
      const signature = alice.sign(userOpHash);

      const settled = await app.inject({
        method: "POST",
        url: `/v1/intents/${intentId}/authorize`,
        payload: { permitSignature, signature },
      });
      expect(settled.statusCode, settled.body).toBe(200);
      expect(settled.json().status).toBe("SETTLED");
      expect(settled.json().state.ledger.ledgerTransactionId).toBeTruthy();

      const bobBal = await chain!.l2.readContract({
        address: chain!.usdc,
        abi: testUSDCAbi,
        functionName: "balanceOf",
        args: [b.address],
      });
      expect(bobBal).toBe(parseUnits("250", 6));
      expect(await chain!.l2.getBalance({ address: a.address })).toBe(0n);

      const receipt = await app.inject({ method: "GET", url: `/v1/settlements/${intentId}` });
      expect(receipt.statusCode, receipt.body).toBe(200);
      const r = receipt.json();
      expect(r.softFinality.state).toBe("INCLUDED");
      expect(["PENDING", "FINALIZED"]).toContain(r.l1Finality.state);
      expect(r.reconciliation.status).toBe("MATCHED");
      expect(Number(r.fees.network)).toBeGreaterThan(0);

      const [sum] = await db<
        { s: string }[]
      >`select coalesce(sum(amount),0)::text as s from ledger_entry e join ledger_transaction t on t.id = e.ledger_transaction_id where t.idempotency_key = ${`intent:${intentId}`}`;
      expect(sum!.s).toBe("0");
      console.log(
        `intent ${intentId} tx ${settled.json().state.txHash} fee ${settled.json().state.feeBaseUnits} l1=${r.l1Finality.state}`,
      );
    }, 180_000);
  },
);

describe.skipIf(!enabled || !chain?.pool)(
  "devnet flow: swap USDC -> EURC through the router and the native pool",
  () => {
    const db = connect(DATABASE_URL);
    const engine = new ExecutionEngine(chain!);
    const app = buildApp({
      intents: new PgIntentRepository(db),
      accounts: new PgAccountRepository(db),
      idempotency: new PgIdempotencyStore(db),
      ledger: new PgLedgerPoster(db),
      engine,
    });
    beforeAll(() => app.ready());
    afterAll(async () => {
      await app.close();
      await db.end({ timeout: 2 });
    });

    it("ranks native vs arc, executes on the pool, receives EURC, pays the fee in USDC", async () => {
      const run = `${Date.now().toString(36)}s`;
      const carol = Passkey.random();
      const res = await app.inject({
        method: "POST",
        url: "/v1/accounts",
        payload: { handle: `carol-${run}`, kind: "business", passkey: carol.publicKey() },
      });
      expect(res.statusCode, res.body).toBe(201);
      const c = res.json() as { accountId: string; address: `0x${string}` };
      const mint = await chain!.bundler.writeContract({
        address: chain!.usdc,
        abi: testUSDCAbi,
        functionName: "mint",
        args: [c.address, parseUnits("2000", 6)],
      });
      await chain!.l2.waitForTransactionReceipt({ hash: mint });

      const created = await app.inject({
        method: "POST",
        url: "/v1/intents",
        headers: { "idempotency-key": `k-${run}`, "x-account-id": c.accountId },
        payload: {
          action: "swap",
          source: { asset: "USDC", amount: parseUnits("1000", 6).toString() },
          destination: { asset: "EURC", recipient: `carol-${run}` },
          constraints: { maxSlippageBps: 50 },
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const intentId = created.json().intentId as string;
      const quoted = await app.inject({ method: "POST", url: `/v1/intents/${intentId}/quote` });
      expect(quoted.statusCode, quoted.body).toBe(200);
      const draft = quoted.json().state.quote as {
        digests: { permit: `0x${string}` };
        route: Array<{ venue: string }>;
        ranked: Array<{ venue: string; executable: boolean }>;
        output: { amountBaseUnits: string };
      };
      expect(["lineth-venue", "native-stableswap"]).toContain(draft.route[0]?.venue);
      expect(draft.ranked.map((r) => r.venue).join(",")).toMatch(/arc-stablefx/);
      expect(BigInt(draft.output.amountBaseUnits)).toBeGreaterThan(parseUnits("990", 6));

      const permitSignature = carol.sign(draft.digests.permit);
      const step1 = await app.inject({
        method: "POST",
        url: `/v1/intents/${intentId}/authorize`,
        payload: { permitSignature },
      });
      const signature = carol.sign(step1.json().userOpHash);
      const settled = await app.inject({
        method: "POST",
        url: `/v1/intents/${intentId}/authorize`,
        payload: { permitSignature, signature },
      });
      expect(settled.statusCode, settled.body).toBe(200);
      expect(settled.json().status).toBe("SETTLED");
      const received = BigInt(settled.json().state.receivedBaseUnits);
      expect(received).toBeGreaterThan(parseUnits("990", 6));
      expect(
        await chain!.l2.readContract({
          address: chain!.eurc!,
          abi: testUSDCAbi,
          functionName: "balanceOf",
          args: [c.address],
        }),
      ).toBe(received);

      const receipt = await app.inject({ method: "GET", url: `/v1/settlements/${intentId}` });
      expect(receipt.statusCode, receipt.body).toBe(200);
      expect(["lineth-venue", "native-stableswap"]).toContain(receipt.json().route[0].venue);
      expect(receipt.json().legs).toHaveLength(2);
      const perAsset = await db<
        { asset_id: string; s: string }[]
      >`select e.asset_id, sum(e.amount)::text as s from ledger_entry e join ledger_transaction t on t.id = e.ledger_transaction_id where t.idempotency_key = ${`intent:${intentId}`} group by e.asset_id`;
      for (const row of perAsset) expect(row.s).toBe("0");
      console.log(
        `swap ${intentId}: received ${received} EURC for 1000 USDC, fee ${settled.json().state.feeBaseUnits}`,
      );
    }, 180_000);
  },
);

describe.skipIf(!enabled || !chain?.dvp)(
  "devnet flow: institutional DvP with approval policy",
  () => {
    const db = connect(DATABASE_URL);
    const engine = new ExecutionEngine(chain!);
    const app = buildApp({
      intents: new PgIntentRepository(db),
      accounts: new PgAccountRepository(db),
      idempotency: new PgIdempotencyStore(db),
      ledger: new PgLedgerPoster(db),
      policies: new PgPolicyRepository(db),
      signatures: new PgSignatureRepository(db),
      engine,
    });
    beforeAll(() => app.ready());
    afterAll(async () => {
      await app.close();
      await db.end({ timeout: 2 });
    });

    it("settles asset-versus-USDC atomically after both signatures and the required approval", async () => {
      const run = `${Date.now().toString(36)}d`;
      const instA = Passkey.random();
      const instB = Passkey.random();
      const mk = async (handle: string, k: Passkey) => {
        const res = await app.inject({
          method: "POST",
          url: "/v1/accounts",
          payload: { handle, kind: "institutional", passkey: k.publicKey() },
        });
        expect(res.statusCode, res.body).toBe(201);
        return res.json() as { accountId: string; address: `0x${string}` };
      };
      const a = await mk(`inst-a-${run}`, instA);
      const b = await mk(`inst-b-${run}`, instB);
      // A holds the "asset" (EURC stands in for a tokenized security), B holds USDC; B requires one approval above 500 USDC
      for (const [token, to, amt] of [
        [chain!.eurc!, a.address, "1000"],
        [chain!.usdc, b.address, "1100"],
      ] as const) {
        const h = await chain!.bundler.writeContract({
          address: token,
          abi: testUSDCAbi,
          functionName: "mint",
          args: [to, parseUnits(amt, 6)],
        });
        await chain!.l2.waitForTransactionReceipt({ hash: h });
      }
      const pol = await app.inject({
        method: "POST",
        url: `/v1/accounts/inst-b-${run}/policy`,
        payload: {
          thresholds: [{ aboveBaseUnits: parseUnits("500", 6).toString(), approvals: 1 }],
        },
      });
      expect(pol.statusCode, pol.body).toBe(200);

      const created = await app.inject({
        method: "POST",
        url: "/v1/intents",
        headers: { "idempotency-key": `k-${run}`, "x-account-id": a.accountId },
        payload: {
          action: "settle",
          source: { asset: "EURC", amount: parseUnits("1000", 6).toString() },
          destination: {
            asset: "USDC",
            recipient: `inst-b-${run}`,
            amount: parseUnits("1050", 6).toString(),
          },
          constraints: { requireAtomicity: true },
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const intentId = created.json().intentId as string;
      const quoted = await app.inject({ method: "POST", url: `/v1/intents/${intentId}/quote` });
      expect(quoted.statusCode, quoted.body).toBe(200);
      const draft = quoted.json().state.quote as {
        digests: { settlement: `0x${string}`; permitA: `0x${string}`; permitB: `0x${string}` };
      };

      const sA = await app.inject({
        method: "POST",
        url: `/v1/intents/${intentId}/sign`,
        payload: {
          party: "A",
          signature: instA.sign(draft.digests.settlement),
          permit: instA.sign(draft.digests.permitA),
        },
      });
      expect(sA.statusCode, sA.body).toBe(200);
      const sB = await app.inject({
        method: "POST",
        url: `/v1/intents/${intentId}/sign`,
        payload: {
          party: "B",
          signature: instB.sign(draft.digests.settlement),
          permit: instB.sign(draft.digests.permitB),
        },
      });
      expect(sB.json().signed).toEqual(["A", "B"]);

      // without the approval the policy blocks execution; the intent waits (still QUOTED, signatures kept)
      const denied = await app.inject({ method: "POST", url: `/v1/intents/${intentId}/execute` });
      expect(denied.statusCode, denied.body).toBe(422);
      expect(denied.json().error.code).toBe("policy_denied");
      expect(
        (await app.inject({ method: "GET", url: `/v1/intents/${intentId}` })).json().status,
      ).toBe("QUOTED");
      const approved = await app.inject({
        method: "POST",
        url: `/v1/intents/${intentId}/approve`,
        payload: { approver: "risk-officer@inst-b" },
      });
      expect(approved.statusCode, approved.body).toBe(200);
      expect(approved.json().required).toBe(1);
      const id2 = intentId;
      const settled = await app.inject({ method: "POST", url: `/v1/intents/${id2}/execute` });
      expect(settled.statusCode, settled.body).toBe(200);
      expect(settled.json().status).toBe("SETTLED");

      expect(
        await chain!.l2.readContract({
          address: chain!.eurc!,
          abi: testUSDCAbi,
          functionName: "balanceOf",
          args: [b.address],
        }),
      ).toBe(parseUnits("1000", 6));
      expect(
        await chain!.l2.readContract({
          address: chain!.usdc,
          abi: testUSDCAbi,
          functionName: "balanceOf",
          args: [a.address],
        }),
      ).toBe(parseUnits("1050", 6));
      const receipt = await app.inject({ method: "GET", url: `/v1/settlements/${id2}` });
      expect(receipt.statusCode, receipt.body).toBe(200);
      expect(receipt.json().legs).toHaveLength(2);
      expect(receipt.json().route[0].venue).toBe("native-dvp");
      const perAsset = await db<
        { s: string }[]
      >`select sum(e.amount)::text as s from ledger_entry e join ledger_transaction t on t.id = e.ledger_transaction_id where t.idempotency_key = ${`intent:${id2}`} group by e.asset_id`;
      for (const row of perAsset) expect(row.s).toBe("0");
      console.log(`dvp ${id2}: tx ${settled.json().state.txHash}`);
    }, 240_000);
  },
);
