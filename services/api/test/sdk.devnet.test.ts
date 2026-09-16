/** The SDK against a live API instance on the devnet: transfer, swap and DvP through `SettlementClient`. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testUSDCAbi } from "@settlement/contracts-abi";
import { Passkey, SettlementClient } from "@settlement/sdk";
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

describe.skipIf(!enabled)("sdk on devnet", () => {
  const db = connect(DATABASE_URL);
  const app = buildApp({
    intents: new PgIntentRepository(db),
    accounts: new PgAccountRepository(db),
    idempotency: new PgIdempotencyStore(db),
    ledger: new PgLedgerPoster(db),
    policies: new PgPolicyRepository(db),
    signatures: new PgSignatureRepository(db),
    engine: new ExecutionEngine(chain!),
  });
  let baseUrl = "";
  beforeAll(async () => {
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => {
    await app.close();
    await db.end({ timeout: 2 });
  });

  it("transfer, swap and settle through the client", async () => {
    const run = `${Date.now().toString(36)}k`;
    const client = new SettlementClient({ baseUrl });
    const alice = Passkey.random();
    const bob = Passkey.random();
    const a = await client.createAccount(`sdk-a-${run}`, alice, "institutional");
    const b = await client.createAccount(`sdk-b-${run}`, bob, "institutional");
    for (const [token, to, amt] of [
      [chain!.usdc, a.address, "3000"],
      [chain!.usdc, b.address, "2000"],
    ] as const) {
      const h = await chain!.bundler.writeContract({
        address: token,
        abi: testUSDCAbi,
        functionName: "mint",
        args: [to, parseUnits(amt, 6)],
      });
      await chain!.l2.waitForTransactionReceipt({ hash: h });
    }
    const t = await client.transfer(a, alice, {
      asset: "USDC",
      amount: parseUnits("100", 6).toString(),
      to: b.handle,
    });
    expect(t.status).toBe("SETTLED");
    const s = await client.swap(a, alice, {
      from: "USDC",
      to: "EURC",
      amount: parseUnits("500", 6).toString(),
      maxSlippageBps: 50,
    });
    expect(s.status).toBe("SETTLED");
    await client.setApprovalPolicy(b.handle, [
      { aboveBaseUnits: parseUnits("100", 6).toString(), approvals: 1 },
    ]);
    const eurcOut = BigInt(s.state.receivedBaseUnits as string);
    const d = await client.settle(
      { account: a, signer: alice },
      { account: b, signer: bob },
      {
        give: { asset: "EURC", amount: eurcOut.toString() },
        receive: { asset: "USDC", amount: parseUnits("480", 6).toString() },
      },
      ["treasury@sdk-b"],
    );
    expect(d.status).toBe("SETTLED");
    const receipt = await client.receipt(d.intentId);
    expect(receipt.legs).toHaveLength(2);
    expect(
      await chain!.l2.readContract({
        address: chain!.eurc!,
        abi: testUSDCAbi,
        functionName: "balanceOf",
        args: [b.address],
      }),
    ).toBe(eurcOut);
    console.log(`sdk: transfer ${t.intentId}, swap ${s.intentId}, dvp ${d.intentId}`);
  }, 300_000);
});
