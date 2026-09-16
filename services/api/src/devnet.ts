import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { publicClient, walletClient } from "@settlement/chain";
import type { Address, Hex } from "viem";
import type { ChainDeps } from "./execution.js";

/**
 * Chain dependencies for the local devnet, read from the files `make devnet-deploy`, `make devnet-milestone-c`
 * and the Lineth quickstart produce. Returns undefined when they are absent (API runs without execution).
 * Production wiring comes from configuration, never from these files.
 */
export function devnetChainDeps(
  repoRoot: string,
  env: { L1_RPC_URL?: string; L2_RPC_URL?: string; BUNDLER_PRIVATE_KEY?: string } = {},
): ChainDeps | undefined {
  const depFile = join(repoRoot, "chain", "lineth", "deployments.local.json");
  const stack = join(
    repoRoot,
    "chain",
    "lineth",
    "upstream",
    "docs",
    "getting-started",
    "lineth-stack",
  );
  const keysFile = join(stack, "artifacts", "accounts", "runtime-keys.env");
  const addrFile = join(stack, "artifacts", "deployments", "addresses.json");
  if (!existsSync(depFile)) return undefined;
  const { contracts } = JSON.parse(readFileSync(depFile, "utf8")) as {
    contracts: Record<string, Address>;
  };
  const needed = ["EntryPoint", "PasskeyAccountFactory", "USDCPaymaster", "TestUSDC"] as const;
  if (!needed.every((k) => contracts[k])) return undefined;
  const bundlerKey = (env.BUNDLER_PRIVATE_KEY ??
    (existsSync(keysFile)
      ? readFileSync(keysFile, "utf8").match(/^L2_DEPLOYER_PRIVATE_KEY='?(0x[0-9a-fA-F]+)'?$/m)?.[1]
      : undefined)) as Hex | undefined;
  if (!bundlerKey) return undefined;
  const rollup = existsSync(addrFile)
    ? (JSON.parse(readFileSync(addrFile, "utf8")) as { l1: Record<string, Address> }).l1
        .LinethRollupV8
    : undefined;
  return {
    chainKey: "l2-devnet",
    l2: publicClient("l2-devnet", env.L2_RPC_URL),
    l1: publicClient("l1-local", env.L1_RPC_URL),
    bundler: walletClient("l2-devnet", bundlerKey, env.L2_RPC_URL),
    entryPoint: contracts.EntryPoint!,
    factory: contracts.PasskeyAccountFactory!,
    paymaster: contracts.USDCPaymaster!,
    usdc: contracts.TestUSDC!,
    ...(rollup ? { rollup } : {}),
  };
}
