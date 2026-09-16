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
} from "@settlement/contracts-abi";
import {
  ArcStableFxAdapter,
  NativeStableSwapAdapter,
  type RouteDecision,
  SmartRouter,
  type Stable,
} from "@settlement/router";
import type { Intent } from "@settlement/types";
import { type Address, encodeFunctionData, type Hex, size } from "viem";
import type { ChainDeps, QuoteDraft } from "./execution.js";
import { serializeOp } from "./execution.js";
import type { AccountRecord } from "./repos/accounts.js";

/** Milestone D/E: `swap` intents routed across venues (blueprint sections 8 and 9) and executed on the native pool. */
export interface SwapDeps extends ChainDeps {
  eurc: Address;
  pool: Address;
}

export interface SwapQuoteDraft extends QuoteDraft {
  route: RouteDecision["legs"];
  ranked: Array<{
    venue: string;
    amountOut: string;
    score: number;
    executable: boolean;
    reason?: string;
  }>;
  output: { asset: Stable; amountBaseUnits: string; minAmountBaseUnits: string };
}

const PERMIT_DEADLINE = (1n << 256n) - 1n;

export function tokenOf(deps: SwapDeps, symbol: Stable): Address {
  return symbol === "USDC" ? deps.usdc : deps.eurc;
}

export async function quoteSwap(
  deps: SwapDeps,
  intent: Intent,
  sender: AccountRecord,
  chainId: number,
): Promise<SwapQuoteDraft> {
  const from = intent.source.asset as Stable;
  const to = intent.destination.asset as Stable;
  if (!["USDC", "EURC"].includes(from) || !["USDC", "EURC"].includes(to) || from === to)
    throw new Error(`swap ${from}->${to} not supported; USDC<->EURC only`);
  const amountIn = BigInt(intent.source.amount);
  const router = new SmartRouter([
    new NativeStableSwapAdapter(deps.l2, {
      pool: deps.pool,
      coins: { USDC: 0, EURC: 1 },
      networkFeeBaseUnits: 4_000_000n,
    }),
    new ArcStableFxAdapter(),
  ]);
  const decision = await router.route({
    chainId,
    from,
    to,
    amountIn,
    ...(intent.constraints.maxSlippageBps !== undefined
      ? { maxSlippageBps: intent.constraints.maxSlippageBps }
      : {}),
    ...(intent.constraints.allowedVenues
      ? { allowedVenues: intent.constraints.allowedVenues }
      : {}),
  });
  const exec = decision.chosen.execution;
  if (exec?.kind !== "stableswap") throw new Error("chosen venue is not executable on this chain");

  const { l2, entryPoint, factory, paymaster, usdc } = deps;
  const tokenIn = tokenOf(deps, from);
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
  const gas = { ...DEVNET_GAS, callGasLimit: 400_000n };
  const maxGas =
    gas.verificationGasLimit +
    gas.callGasLimit +
    gas.preVerificationGas +
    gas.paymasterVerificationGasLimit +
    gas.paymasterPostOpGasLimit;
  const maxToken = (maxGas * gas.maxFeePerGas * tokenPerEth + 10n ** 18n - 1n) / 10n ** 18n;
  const permit = permitDigest({
    chainId,
    token: usdc,
    tokenName,
    owner: sender.address,
    spender: paymaster,
    value: maxToken,
    nonce: permitNonce,
  });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
  const op: PackedUserOperation = {
    sender: sender.address,
    nonce,
    initCode:
      code && size(code) > 0
        ? "0x"
        : encodeInitCode(factory, sender.signer.qx, sender.signer.qy, sender.signer.salt),
    callData: encodeBatchCall([
      {
        target: tokenIn,
        value: 0n,
        callData: encodeFunctionData({
          abi: testUSDCAbi,
          functionName: "approve",
          args: [exec.pool, amountIn],
        }),
      },
      {
        target: exec.pool,
        value: 0n,
        callData: encodeFunctionData({
          abi: stableSwapPoolAbi,
          functionName: "exchange",
          args: [
            BigInt(exec.i),
            BigInt(exec.j),
            amountIn,
            exec.minAmountOut,
            sender.address,
            deadline,
          ],
        }),
      },
    ]),
    accountGasLimits: packUint128Pair(gas.verificationGasLimit, gas.callGasLimit),
    preVerificationGas: gas.preVerificationGas,
    gasFees: packUint128Pair(gas.maxPriorityFeePerGas, gas.maxFeePerGas),
    paymasterAndData: encodePaymasterAndData({
      paymaster,
      verificationGasLimit: gas.paymasterVerificationGasLimit,
      postOpGasLimit: gas.paymasterPostOpGasLimit,
      token: usdc,
      permitAmount: maxToken,
      permitSignature: "0x",
    }),
    signature: "0x",
  };
  return {
    digests: { permit, userOp: "0x" },
    userOp: serializeOp(op),
    fee: {
      asset: "USDC",
      maxBaseUnits: maxToken.toString(),
      estimateBaseUnits: ((700_000n * gas.maxFeePerGas * tokenPerEth) / 10n ** 18n).toString(),
      tokenPerEth: tokenPerEth.toString(),
    },
    permit: {
      spender: paymaster,
      amount: maxToken.toString(),
      nonce: permitNonce.toString(),
      deadline: PERMIT_DEADLINE.toString(),
    },
    expiresAt: new Date(
      Math.min(Date.now() + 5 * 60_000, decision.chosen.validUntil * 1000),
    ).toISOString(),
    route: decision.legs,
    ranked: decision.ranked.map((q) => ({
      venue: q.venue,
      amountOut: q.amountOut.toString(),
      score: Math.round(q.score),
      executable: q.executable,
      ...(q.reason ? { reason: q.reason } : {}),
    })),
    output: {
      asset: to,
      amountBaseUnits: decision.chosen.amountOut.toString(),
      minAmountBaseUnits: exec.minAmountOut.toString(),
    },
  };
}

export type { Hex };
