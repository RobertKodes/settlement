import { entryPointAbi } from "@settlement/contracts-abi";
import { type Address, type Hex, parseEventLogs } from "viem";
import type { PublicClient, WalletClient } from "./clients.js";
import type { PackedUserOperation } from "./userop.js";

export interface UserOpResult {
  txHash: Hex;
  blockNumber: bigint;
  userOpHash: Hex;
  success: boolean;
  actualGasCost: bigint;
  actualGasUsed: bigint;
}

/**
 * Submit user operations through EntryPoint.handleOps from a bundler EOA and wait for inclusion.
 * A real bundler (or a bundler RPC) replaces this in Phase 2; the interface stays.
 */
export async function submitUserOps(
  wallet: WalletClient,
  client: PublicClient,
  entryPoint: Address,
  ops: PackedUserOperation[],
  beneficiary: Address,
): Promise<UserOpResult[]> {
  const txHash = await wallet.writeContract({
    address: entryPoint,
    abi: entryPointAbi,
    functionName: "handleOps",
    args: [ops, beneficiary],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`handleOps reverted in ${txHash}`);
  const events = parseEventLogs({
    abi: entryPointAbi,
    eventName: "UserOperationEvent",
    logs: receipt.logs,
  });
  return events.map((e) => ({
    txHash,
    blockNumber: receipt.blockNumber,
    userOpHash: e.args.userOpHash,
    success: e.args.success,
    actualGasCost: e.args.actualGasCost,
    actualGasUsed: e.args.actualGasUsed,
  }));
}
