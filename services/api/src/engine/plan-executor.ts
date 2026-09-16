import {
  DEVNET_GAS,
  encodeBatchCall,
  encodeInitCode,
  encodePaymasterAndData,
  type PackedUserOperation,
  packUint128Pair,
  permitDigest,
} from "@settlement/chain";
import {
  entryPointAbi,
  stableSwapPoolAbi,
  testUSDCAbi,
  usdcPaymasterAbi,
  venueRouterAbi,
} from "@settlement/contracts-abi";
import type { Leg, RoutePlan } from "@settlement/router";
import { type Address, encodeFunctionData, type Hex, size } from "viem";
import type { ChainDeps, QuoteDraft } from "../execution.js";
import { serializeOp } from "../execution.js";
import type { AccountRecord } from "../repos/accounts.js";

/**
 * Architecture v2 settlement engine: a plan executes leg by leg. Each leg kind has a handler; a handler either
 * produces the on-chain action for that leg or refuses with the leg's BLOCKED reason. Today the executable
 * legs are Lineth `pool-swap` (venue or StableSwap) as an account operation through the paymaster; `cctp`,
 * `stablefx` and Arc legs are wired to their clients but refuse until their external dependency exists.
 * Leg state is persisted by the caller in `intent.body.state.legs` (durable, per leg), so a multi-leg plan can
 * resume after a failure without re-running completed legs.
 */
export interface LegState {
  id: string;
  status: "pending" | "executing" | "done" | "failed" | "blocked";
  txHash?: Hex;
  blockNumber?: string;
  amountOut?: string;
  error?: string;
}

export interface SwapPlanDraft extends QuoteDraft {
  plan: {
    id: string;
    legs: Array<
      Omit<Leg, "amountIn" | "amountOut" | "minAmountOut" | "feeBaseUnits"> & {
        amountIn: string;
        amountOut: string;
        minAmountOut?: string;
        feeBaseUnits: string;
      }
    >;
    blocked: string[];
    score: number;
  };
  ranked: Array<{
    venue: string;
    amountOut: string;
    score: number;
    executable: boolean;
    reason?: string;
  }>;
  route: Array<{ venue: string; shareBps: number; chainId?: number }>;
  output: { asset: string; amountBaseUnits: string; minAmountBaseUnits: string };
}

export function serializePlan(p: RoutePlan): SwapPlanDraft["plan"] {
  return {
    id: p.id,
    blocked: p.blocked,
    score: p.score,
    legs: p.legs.map(({ amountIn, amountOut, minAmountOut, feeBaseUnits, ...rest }) => ({
      ...rest,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      ...(minAmountOut !== undefined ? { minAmountOut: minAmountOut.toString() } : {}),
      feeBaseUnits: feeBaseUnits.toString(),
    })),
  };
}

const _PERMIT_DEADLINE = (1n << 256n) - 1n;

/** Builds the unsigned account operation for a single Lineth pool-swap leg (venue-v2 or StableSwap). */
export async function buildLinethSwapOp(
  deps: ChainDeps,
  sender: AccountRecord,
  leg: SwapPlanDraft["plan"]["legs"][number],
  chainId: number,
): Promise<{
  op: PackedUserOperation;
  permitDigest: Hex;
  permitAmount: bigint;
  tokenPerEth: bigint;
}> {
  const { l2, entryPoint, factory, paymaster, usdc } = deps;
  const amountIn = BigInt(leg.amountIn);
  const minOut = BigInt(leg.minAmountOut ?? "0");
  const params = (leg.params ?? {}) as {
    router?: Address;
    path?: Address[];
    pool?: Address;
    i?: number;
    j?: number;
  };
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
  const executions =
    params.router && params.path
      ? [
          {
            target: params.path[0]!,
            value: 0n,
            callData: encodeFunctionData({
              abi: testUSDCAbi,
              functionName: "approve",
              args: [params.router, amountIn],
            }),
          },
          {
            target: params.router,
            value: 0n,
            callData: encodeFunctionData({
              abi: venueRouterAbi,
              functionName: "swapExactTokensForTokens",
              args: [amountIn, minOut, params.path, sender.address, deadline],
            }),
          },
        ]
      : params.pool !== undefined && params.i !== undefined && params.j !== undefined
        ? [
            {
              target: params.i === 0 ? usdc : (deps.eurc as Address),
              value: 0n,
              callData: encodeFunctionData({
                abi: testUSDCAbi,
                functionName: "approve",
                args: [params.pool, amountIn],
              }),
            },
            {
              target: params.pool,
              value: 0n,
              callData: encodeFunctionData({
                abi: stableSwapPoolAbi,
                functionName: "exchange",
                args: [
                  BigInt(params.i),
                  BigInt(params.j),
                  amountIn,
                  minOut,
                  sender.address,
                  deadline,
                ],
              }),
            },
          ]
        : undefined;
  if (!executions) throw new Error(`leg ${leg.id} has no executable parameters`);
  const [code, nonce, permitNonce, tokenPerEth, tokenName] = await Promise.all([
    l2.getCode({ address: sender.address }),
    l2.readContract({
      address: entryPoint,
      abi: entryPointAbi,
      functionName: "getNonce",
      args: [sender.address, 0n],
    }),
    l2.readContract({
      address: usdc,
      abi: testUSDCAbi,
      functionName: "nonces",
      args: [sender.address],
    }),
    l2.readContract({ address: paymaster, abi: usdcPaymasterAbi, functionName: "tokenPerEth" }),
    l2.readContract({ address: usdc, abi: testUSDCAbi, functionName: "name" }),
  ]);
  const gas = { ...DEVNET_GAS, callGasLimit: 450_000n };
  const maxGas =
    gas.verificationGasLimit +
    gas.callGasLimit +
    gas.preVerificationGas +
    gas.paymasterVerificationGasLimit +
    gas.paymasterPostOpGasLimit;
  const permitAmount = (maxGas * gas.maxFeePerGas * tokenPerEth + 10n ** 18n - 1n) / 10n ** 18n;
  const op: PackedUserOperation = {
    sender: sender.address,
    nonce,
    initCode:
      code && size(code) > 0
        ? "0x"
        : encodeInitCode(factory, sender.signer.qx, sender.signer.qy, sender.signer.salt),
    callData: encodeBatchCall(executions),
    accountGasLimits: packUint128Pair(gas.verificationGasLimit, gas.callGasLimit),
    preVerificationGas: gas.preVerificationGas,
    gasFees: packUint128Pair(gas.maxPriorityFeePerGas, gas.maxFeePerGas),
    paymasterAndData: encodePaymasterAndData({
      paymaster,
      verificationGasLimit: gas.paymasterVerificationGasLimit,
      postOpGasLimit: gas.paymasterPostOpGasLimit,
      token: usdc,
      permitAmount,
      permitSignature: "0x",
    }),
    signature: "0x",
  };
  return {
    op,
    permitDigest: permitDigest({
      chainId,
      token: usdc,
      tokenName,
      owner: sender.address,
      spender: paymaster,
      value: permitAmount,
      nonce: permitNonce,
    }),
    permitAmount,
    tokenPerEth,
  };
}

/** Which legs the engine can execute today; the rest refuse with the leg's own reason. */
export function legExecutability(leg: {
  system: string;
  kind: string;
  executable: boolean;
  blockedReason?: string | undefined;
}): { ok: true } | { ok: false; reason: string } {
  if (!leg.executable) return { ok: false, reason: leg.blockedReason ?? "leg not executable" };
  if (leg.system === "lineth" && leg.kind === "pool-swap") return { ok: true };
  if (leg.system === "arc" && leg.kind === "pool-swap")
    return {
      ok: false,
      reason:
        "Arc account operations need the Arc EntryPoint + factory deployed (make arc-deploy) and an Arc bundler key",
    };
  if (leg.system === "cctp")
    return {
      ok: false,
      reason: "CCTP execution needs funded keys on both domains (CctpV2Client is wired)",
    };
  if (leg.kind === "stablefx")
    return { ok: false, reason: "StableFX needs an institutional API key from Circle" };
  return { ok: false, reason: `no executor for ${leg.system}/${leg.kind} yet` };
}

export { serializeOp };
