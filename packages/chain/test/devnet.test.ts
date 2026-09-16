/**
 * Milestone C from TypeScript against the running local devnet. Run with `pnpm test:devnet` (DEVNET=1)
 * after `make devnet-up && make devnet-deploy && make devnet-milestone-c`. Skipped otherwise.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { testUSDCAbi } from "@settlement/contracts-abi";
import { type Address, type Hex, parseUnits } from "viem";
import { describe, expect, it } from "vitest";
import { publicClient, walletClient } from "../src/clients.js";
import { finalityOf, readFinalizedL2Block } from "../src/finality.js";
import { Passkey } from "../src/passkey.js";
import { submitUserOps } from "../src/submit.js";
import { buildSignedUserOp, encodeErc20Transfer } from "../src/userop.js";

const root = join(import.meta.dirname, "..", "..", "..");
const depFile = join(root, "chain", "lineth", "deployments.local.json");
const keysFile = join(
  root,
  "chain",
  "lineth",
  "upstream",
  "docs",
  "getting-started",
  "lineth-stack",
  "artifacts",
  "accounts",
  "runtime-keys.env",
);
const addrFile = join(
  root,
  "chain",
  "lineth",
  "upstream",
  "docs",
  "getting-started",
  "lineth-stack",
  "artifacts",
  "deployments",
  "addresses.json",
);
const enabled = process.env.DEVNET === "1" && existsSync(depFile) && existsSync(keysFile);

describe.skipIf(!enabled)("devnet: passkey account pays gas in USDC", () => {
  it("creates the account, pays a merchant, charges the fee in USDC and reports finality", async () => {
    const dep = JSON.parse(readFileSync(depFile, "utf8")) as {
      contracts: {
        EntryPoint: Address;
        PasskeyAccountFactory: Address;
        USDCPaymaster: Address;
        TestUSDC: Address;
      };
    };
    const { EntryPoint, PasskeyAccountFactory, USDCPaymaster, TestUSDC } = dep.contracts;
    for (const [k, v] of Object.entries({
      EntryPoint,
      PasskeyAccountFactory,
      USDCPaymaster,
      TestUSDC,
    })) {
      if (!v)
        throw new Error(`${k} missing in deployments.local.json — run make devnet-milestone-c`);
    }
    const deployerKey = readFileSync(keysFile, "utf8").match(
      /^L2_DEPLOYER_PRIVATE_KEY='?(0x[0-9a-fA-F]+)'?$/m,
    )![1] as Hex;
    const l2 = publicClient("l2-devnet");
    const deployer = walletClient("l2-devnet", deployerKey);
    const merchant: Address = "0x000000000000000000000000000000000000cafe";

    const passkey = Passkey.random();
    const { qx, qy } = passkey.publicKey();
    const account = await l2.readContract({
      address: PasskeyAccountFactory,
      abi: (await import("@settlement/contracts-abi")).passkeyAccountFactoryAbi,
      functionName: "getAddress",
      args: [qx, qy, `0x${"00".repeat(32)}`],
    });
    const mintTx = await deployer.writeContract({
      address: TestUSDC,
      abi: testUSDCAbi,
      functionName: "mint",
      args: [account, parseUnits("1000", 6)],
    });
    await l2.waitForTransactionReceipt({ hash: mintTx });
    const merchantBefore = await l2.readContract({
      address: TestUSDC,
      abi: testUSDCAbi,
      functionName: "balanceOf",
      args: [merchant],
    });

    const { op, userOpHash } = await buildSignedUserOp(l2, {
      entryPoint: EntryPoint,
      factory: PasskeyAccountFactory,
      paymaster: USDCPaymaster,
      token: TestUSDC,
      passkey,
      executions: [encodeErc20Transfer(TestUSDC, merchant, parseUnits("250", 6))],
      permitAmount: parseUnits("50", 6),
    });
    expect(op.initCode).not.toBe("0x");
    const [result] = await submitUserOps(deployer, l2, EntryPoint, [op], deployer.account.address);
    expect(result?.userOpHash).toBe(userOpHash);
    expect(result?.success).toBe(true);

    const merchantAfter = await l2.readContract({
      address: TestUSDC,
      abi: testUSDCAbi,
      functionName: "balanceOf",
      args: [merchant],
    });
    const accountUsdc = await l2.readContract({
      address: TestUSDC,
      abi: testUSDCAbi,
      functionName: "balanceOf",
      args: [account],
    });
    const fee = parseUnits("1000", 6) - parseUnits("250", 6) - accountUsdc;
    expect(merchantAfter - merchantBefore).toBe(parseUnits("250", 6));
    expect(fee).toBeGreaterThan(0n);
    expect(fee).toBeLessThan(parseUnits("50", 6));
    expect(await l2.getBalance({ address: account })).toBe(0n);

    if (existsSync(addrFile)) {
      const rollup = (JSON.parse(readFileSync(addrFile, "utf8")) as { l1: Record<string, Address> })
        .l1.LinethRollupV8;
      if (!rollup) throw new Error("LinethRollupV8 missing in upstream addresses.json");
      const finalized = await readFinalizedL2Block(publicClient("l1-local"), rollup);
      expect(["INCLUDED", "FINALIZED"]).toContain(finalityOf(result!.blockNumber, finalized));
    }
    console.log(
      `account ${account} fee ${fee} base units, tx ${result?.txHash} block ${result?.blockNumber}`,
    );
  }, 120_000);
});
