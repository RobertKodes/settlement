import { permitDigest } from "@settlement/chain";
import { dvpSettlementAbi, testUSDCAbi } from "@settlement/contracts-abi";
import type { Intent } from "@settlement/types";
import { type Address, type Hex, keccak256, parseEventLogs, toHex } from "viem";
import type { ChainDeps } from "./execution.js";
import type { AccountRecord } from "./repos/accounts.js";

/** Milestone F: atomic DvP/PvP between two accounts through DvPSettlement (blueprint section 10). */
export interface SettleDeps extends ChainDeps {
  dvp: Address;
  eurc?: Address;
}

export interface SettlementStruct {
  legA: { from: Address; to: Address; token: Address; amount: string };
  legB: { from: Address; to: Address; token: Address; amount: string };
  deadline: string;
  nonce: Hex;
}

export interface SettleQuoteDraft {
  kind: "dvp";
  settlement: SettlementStruct;
  /** Party A signs `settlement` and `permitA`; party B signs `settlement` and `permitB`. */
  digests: { settlement: Hex; permitA: Hex; permitB: Hex };
  parties: { A: { accountId: string; handle: string }; B: { accountId: string; handle: string } };
  expiresAt: string;
}

function tokenFor(deps: SettleDeps, symbol: string): Address {
  if (symbol === "USDC") return deps.usdc;
  if (symbol === "EURC" && deps.eurc) return deps.eurc;
  throw new Error(`asset ${symbol} is not available on this chain`);
}

export async function quoteSettle(
  deps: SettleDeps,
  intent: Intent,
  partyA: AccountRecord,
  partyB: AccountRecord,
  chainId: number,
  intentId: string,
): Promise<SettleQuoteDraft> {
  if (!intent.destination.amount)
    throw new Error("settle intents need destination.amount (the counter-leg)");
  const tokenA = tokenFor(deps, intent.source.asset);
  const tokenB = tokenFor(deps, intent.destination.asset);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);
  const settlement: SettlementStruct = {
    legA: { from: partyA.address, to: partyB.address, token: tokenA, amount: intent.source.amount },
    legB: {
      from: partyB.address,
      to: partyA.address,
      token: tokenB,
      amount: intent.destination.amount,
    },
    deadline: deadline.toString(),
    nonce: keccak256(toHex(intentId)),
  };
  const digest = await deps.l2.readContract({
    address: deps.dvp,
    abi: dvpSettlementAbi,
    functionName: "settlementId",
    args: [
      {
        legA: { ...settlement.legA, amount: BigInt(settlement.legA.amount) },
        legB: { ...settlement.legB, amount: BigInt(settlement.legB.amount) },
        deadline,
        nonce: settlement.nonce,
      },
    ],
  });
  const [nameA, nameB, nonceA, nonceB] = await Promise.all([
    deps.l2.readContract({ address: tokenA, abi: testUSDCAbi, functionName: "name" }),
    deps.l2.readContract({ address: tokenB, abi: testUSDCAbi, functionName: "name" }),
    deps.l2.readContract({
      address: tokenA,
      abi: testUSDCAbi,
      functionName: "nonces",
      args: [partyA.address],
    }),
    deps.l2.readContract({
      address: tokenB,
      abi: testUSDCAbi,
      functionName: "nonces",
      args: [partyB.address],
    }),
  ]);
  return {
    kind: "dvp",
    settlement,
    digests: {
      settlement: digest,
      permitA: permitDigest({
        chainId,
        token: tokenA,
        tokenName: nameA,
        owner: partyA.address,
        spender: deps.dvp,
        value: BigInt(settlement.legA.amount),
        nonce: nonceA,
      }),
      permitB: permitDigest({
        chainId,
        token: tokenB,
        tokenName: nameB,
        owner: partyB.address,
        spender: deps.dvp,
        value: BigInt(settlement.legB.amount),
        nonce: nonceB,
      }),
    },
    parties: {
      A: { accountId: partyA.accountId, handle: partyA.handle },
      B: { accountId: partyB.accountId, handle: partyB.handle },
    },
    expiresAt: new Date(Number(deadline) * 1000).toISOString(),
  };
}

/** The settlement agent submits both signatures (and permits) in one transaction. */
export async function executeSettle(
  deps: SettleDeps,
  draft: SettleQuoteDraft,
  sigA: Hex,
  sigB: Hex,
  permitA: Hex = "0x",
  permitB: Hex = "0x",
) {
  const s = draft.settlement;
  const txHash = await deps.bundler.writeContract({
    address: deps.dvp,
    abi: dvpSettlementAbi,
    functionName: "settleWithPermits",
    args: [
      {
        legA: { ...s.legA, amount: BigInt(s.legA.amount) },
        legB: { ...s.legB, amount: BigInt(s.legB.amount) },
        deadline: BigInt(s.deadline),
        nonce: s.nonce,
      },
      sigA,
      sigB,
      permitA,
      permitB,
    ],
  });
  const receipt = await deps.l2.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`settlement reverted in ${txHash}`);
  const [ev] = parseEventLogs({ abi: dvpSettlementAbi, eventName: "Settled", logs: receipt.logs });
  return { txHash, blockNumber: receipt.blockNumber, settlementHash: ev?.args.id };
}
