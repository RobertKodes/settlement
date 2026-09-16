import { linethRollupAbi } from "@settlement/contracts-abi";
import type { Address } from "viem";
import type { PublicClient } from "./clients.js";

export type FinalityState = "PENDING" | "INCLUDED" | "FINALIZED";

/** Highest L2 block whose proof the L1 rollup contract has verified. */
export async function readFinalizedL2Block(l1: PublicClient, rollup: Address): Promise<bigint> {
  return l1.readContract({
    address: rollup,
    abi: linethRollupAbi,
    functionName: "currentL2BlockNumber",
  });
}

/** Settlement-receipt finality for a transaction included in `l2Block` (blueprint section 10). */
export function finalityOf(l2Block: bigint | undefined, finalizedL2Block: bigint): FinalityState {
  if (l2Block === undefined) return "PENDING";
  return l2Block <= finalizedL2Block ? "FINALIZED" : "INCLUDED";
}
