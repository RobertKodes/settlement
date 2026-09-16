import {
  entryPointAbi,
  passkeyAccountAbi,
  passkeyAccountFactoryAbi,
  testUSDCAbi,
} from "@settlement/contracts-abi";
import {
  type Address,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  hashTypedData,
  numberToHex,
  pad,
  size,
} from "viem";
import type { PublicClient } from "./clients.js";
import type { Passkey } from "./passkey.js";

/** EntryPoint v0.8 packed user operation, as the contract wants it. */
export interface PackedUserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

/** ERC-7821 batch mode: callType 0x01 ‖ execType 0x00 ‖ zeros. The account supports batch mode only. */
export const ERC7821_MODE_BATCH: Hex = `0x01${"00".repeat(31)}`;

export interface Execution {
  target: Address;
  value: bigint;
  callData: Hex;
}

/** Two uint128 packed into one bytes32 (accountGasLimits = verification ‖ call, gasFees = maxPriority ‖ maxFee). */
export function packUint128Pair(high: bigint, low: bigint): Hex {
  return concatHex([pad(numberToHex(high), { size: 16 }), pad(numberToHex(low), { size: 16 })]);
}

/** callData for PasskeyAccount.execute(MODE_BATCH, abi.encode(Execution[])). */
export function encodeBatchCall(executions: Execution[]): Hex {
  const executionData = encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    [executions],
  );
  return encodeFunctionData({
    abi: passkeyAccountAbi,
    functionName: "execute",
    args: [ERC7821_MODE_BATCH, executionData],
  });
}

export function encodeErc20Transfer(token: Address, to: Address, amount: bigint): Execution {
  return {
    target: token,
    value: 0n,
    callData: encodeFunctionData({
      abi: testUSDCAbi,
      functionName: "transfer",
      args: [to, amount],
    }),
  };
}

/** initCode = factory ‖ createAccount(qx, qy, salt). Empty once the account exists. */
export function encodeInitCode(factory: Address, qx: Hex, qy: Hex, salt: Hex): Hex {
  return concatHex([
    factory,
    encodeFunctionData({
      abi: passkeyAccountFactoryAbi,
      functionName: "createAccount",
      args: [qx, qy, salt],
    }),
  ]);
}

export interface PaymasterDataInput {
  paymaster: Address;
  verificationGasLimit: bigint;
  postOpGasLimit: bigint;
  token: Address;
  permitAmount: bigint;
  permitSignature: Hex;
}

/** USDCPaymaster / Circle Paymaster layout: paymaster ‖ vgl(16) ‖ pogl(16) ‖ mode(1)=0 ‖ token ‖ permitAmount(32) ‖ sig. */
export function encodePaymasterAndData(p: PaymasterDataInput): Hex {
  return concatHex([
    p.paymaster,
    pad(numberToHex(p.verificationGasLimit), { size: 16 }),
    pad(numberToHex(p.postOpGasLimit), { size: 16 }),
    "0x00",
    p.token,
    pad(numberToHex(p.permitAmount), { size: 32 }),
    p.permitSignature,
  ]);
}

export const PERMIT_DEADLINE_MAX = (1n << 256n) - 1n;

/** EIP-2612 digest for `token` (EIP-712 domain name/version must match the token's). */
export function permitDigest(p: {
  chainId: number;
  token: Address;
  tokenName: string;
  tokenVersion?: string;
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline?: bigint;
}): Hex {
  return hashTypedData({
    domain: {
      name: p.tokenName,
      version: p.tokenVersion ?? "1",
      chainId: p.chainId,
      verifyingContract: p.token,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner: p.owner,
      spender: p.spender,
      value: p.value,
      nonce: p.nonce,
      deadline: p.deadline ?? PERMIT_DEADLINE_MAX,
    },
  });
}

export interface GasConfig {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}

/** Devnet defaults sized for two Solidity P-256 verifications (user op + permit) plus a clone deployment. */
export const DEVNET_GAS: GasConfig = {
  verificationGasLimit: 1_200_000n,
  callGasLimit: 200_000n,
  preVerificationGas: 60_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  paymasterVerificationGasLimit: 900_000n,
  paymasterPostOpGasLimit: 60_000n,
};

export interface TransferOpInput {
  entryPoint: Address;
  factory: Address;
  paymaster: Address;
  token: Address;
  tokenName?: string;
  passkey: Passkey;
  salt?: Hex;
  executions: Execution[];
  permitAmount: bigint;
  gas?: Partial<GasConfig>;
}

/**
 * Builds and signs a complete user operation for a PasskeyAccount paying gas in USDC through the paymaster.
 * Reads the account address, nonces and deployment state from the chain; adds initCode on the first op.
 */
export async function buildSignedUserOp(
  client: PublicClient,
  input: TransferOpInput,
): Promise<{ op: PackedUserOperation; account: Address; userOpHash: Hex }> {
  const gas = { ...DEVNET_GAS, ...input.gas };
  const { qx, qy } = input.passkey.publicKey();
  const salt = input.salt ?? (`0x${"00".repeat(32)}` as Hex);
  const account = await client.readContract({
    address: input.factory,
    abi: passkeyAccountFactoryAbi,
    functionName: "getAddress",
    args: [qx, qy, salt],
  });
  const [code, nonce, permitNonce, chainId] = await Promise.all([
    client.getCode({ address: account }),
    client.readContract({
      address: input.entryPoint,
      abi: entryPointAbi,
      functionName: "getNonce",
      args: [account, 0n],
    }),
    client.readContract({
      address: input.token,
      abi: testUSDCAbi,
      functionName: "nonces",
      args: [account],
    }),
    client.getChainId(),
  ]);
  const tokenName =
    input.tokenName ??
    (await client.readContract({ address: input.token, abi: testUSDCAbi, functionName: "name" }));
  const permitSignature = input.passkey.sign(
    permitDigest({
      chainId,
      token: input.token,
      tokenName,
      owner: account,
      spender: input.paymaster,
      value: input.permitAmount,
      nonce: permitNonce,
    }),
  );
  const op: PackedUserOperation = {
    sender: account,
    nonce,
    initCode: code && size(code) > 0 ? "0x" : encodeInitCode(input.factory, qx, qy, salt),
    callData: encodeBatchCall(input.executions),
    accountGasLimits: packUint128Pair(gas.verificationGasLimit, gas.callGasLimit),
    preVerificationGas: gas.preVerificationGas,
    gasFees: packUint128Pair(gas.maxPriorityFeePerGas, gas.maxFeePerGas),
    paymasterAndData: encodePaymasterAndData({
      paymaster: input.paymaster,
      verificationGasLimit: gas.paymasterVerificationGasLimit,
      postOpGasLimit: gas.paymasterPostOpGasLimit,
      token: input.token,
      permitAmount: input.permitAmount,
      permitSignature,
    }),
    signature: "0x",
  };
  const userOpHash = await client.readContract({
    address: input.entryPoint,
    abi: entryPointAbi,
    functionName: "getUserOpHash",
    args: [op],
  });
  op.signature = input.passkey.sign(userOpHash);
  return { op, account, userOpHash };
}
