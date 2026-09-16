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
import { PgAccountRepository } from "../src/repos/accounts.js";
import { PgIdempotencyStore } from "../src/repos/idempotency.js";
import { PgIntentRepository } from "../src/repos/intents.js";

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
