import {
  buildSignedUserOp,
  DEVNET_GAS,
  encodeBatchCall,
  encodeErc20Transfer,
  encodeInitCode,
  encodePaymasterAndData,
  finalityOf,
  type PackedUserOperation,
  type PublicClient,
  packUint128Pair,
  permitDigest,
  readFinalizedL2Block,
  submitUserOps,
  type WalletClient,
} from "@settlement/chain";
import { CHAINS, type ChainKey } from "@settlement/config";
import {
  entryPointAbi,
  passkeyAccountFactoryAbi,
  testUSDCAbi,
  usdcPaymasterAbi,
} from "@settlement/contracts-abi";
import type { Intent } from "@settlement/types";
import { type Address, type Hex, size } from "viem";
import type { AccountRecord } from "./repos/accounts.js";

/** Chain-side dependencies of the execution engine for one network (devnet today). */
export interface ChainDeps {
  chainKey: ChainKey;
  l2: PublicClient;
  l1?: PublicClient;
  bundler: WalletClient;
  entryPoint: Address;
  factory: Address;
  paymaster: Address;
  usdc: Address;
  rollup?: Address;
  /** Milestone D: USDC/EURC StableSwap pool and the EURC token, when deployed. */
  eurc?: Address;
  pool?: Address;
  /** Milestone F: DvPSettlement contract, when deployed. */
  dvp?: Address;
}

/** JSON- and database-safe form of PackedUserOperation (bigints as decimal strings). */
export interface SerializedUserOp {
  sender: Address;
  nonce: string;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: string;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

export function serializeOp(op: PackedUserOperation): SerializedUserOp {
  return {
    ...op,
    nonce: op.nonce.toString(),
    preVerificationGas: op.preVerificationGas.toString(),
  };
}

export function deserializeOp(op: SerializedUserOp): PackedUserOperation {
  return { ...op, nonce: BigInt(op.nonce), preVerificationGas: BigInt(op.preVerificationGas) };
}

export interface QuoteDraft {
  /** The two digests the passkey must sign, in order: permit (fee allowance) and the user operation. */
  digests: { permit: Hex; userOp: Hex };
  /** Unsigned operation; returned so the client can verify what it signs. Signature fields are empty. */
  userOp: SerializedUserOp;
  fee: { asset: "USDC"; maxBaseUnits: string; estimateBaseUnits: string; tokenPerEth: string };
  permit: { spender: Address; amount: string; nonce: string; deadline: string };
  expiresAt: string;
}

const USDC_DECIMALS = 6;
const PERMIT_DEADLINE = (1n << 256n) - 1n;

export class ExecutionEngine {
  constructor(private readonly deps: ChainDeps) {}

  get chainId(): number {
    return CHAINS[this.deps.chainKey].chainId;
  }

  get settleDeps() {
    return this.deps.dvp ? { ...this.deps, dvp: this.deps.dvp } : undefined;
  }

  get tokens(): { usdc: Address; eurc?: Address } {
    return { usdc: this.deps.usdc, ...(this.deps.eurc ? { eurc: this.deps.eurc } : {}) };
  }

  /** Resolve the destination of a transfer intent: an address, or a known account's address. */
  resolveRecipient(
    intent: Intent,
    lookup: (handle: string) => Promise<AccountRecord | undefined>,
  ): Promise<{ address: Address; accountId?: string }> {
    const r = intent.destination.recipient;
    if (/^0x[0-9a-fA-F]{40}$/.test(r)) return Promise.resolve({ address: r as Address });
    return lookup(r).then((acct) => {
      if (!acct) throw new Error(`unknown recipient ${r}`);
      return { address: acct.address, accountId: acct.accountId };
    });
  }

  /** Builds the unsigned operation and the digests to sign. Only USDC transfers on this chain are supported today. */
  async quote(intent: Intent, sender: AccountRecord, recipient: Address): Promise<QuoteDraft> {
    if (intent.action === "swap") {
      if (!this.deps.eurc || !this.deps.pool)
        throw new Error(
          "swap needs the EURC token and the StableSwap pool deployed (make devnet-deploy)",
        );
      const { quoteSwap } = await import("./swap.js");
      return quoteSwap(
        { ...this.deps, eurc: this.deps.eurc, pool: this.deps.pool },
        intent,
        sender,
        this.chainId,
      );
    }
    if (intent.action !== "transfer")
      throw new Error(`action ${intent.action} not supported by the devnet execution engine`);
    if (intent.source.asset !== "USDC")
      throw new Error(`asset ${intent.source.asset} not supported; only USDC`);
    const { l2, entryPoint, factory, paymaster, usdc } = this.deps;
    const amount = BigInt(intent.source.amount);
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
    const gas = DEVNET_GAS;
    const deployed = !!code && size(code) > 0;
    const maxGas =
      gas.verificationGasLimit +
      gas.callGasLimit +
      gas.preVerificationGas +
      gas.paymasterVerificationGasLimit +
      gas.paymasterPostOpGasLimit;
    const maxWei = maxGas * gas.maxFeePerGas;
    const maxToken = (maxWei * tokenPerEth + 10n ** 18n - 1n) / 10n ** 18n;
    const estimateToken =
      ((deployed ? 550_000n : 900_000n) * gas.maxFeePerGas * tokenPerEth) / 10n ** 18n;
    const permitAmount = maxToken;
    const permit = permitDigest({
      chainId: this.chainId,
      token: usdc,
      tokenName,
      owner: sender.address,
      spender: paymaster,
      value: permitAmount,
      nonce: permitNonce,
    });
    // paymasterAndData with a zero permit signature: the hash covers paymasterAndData, so the signed permit
    // must be inserted before hashing. We therefore return the userOp hash computed on the FINAL layout,
    // which the client can reproduce once it has signed the permit. See authorize().
    const op: PackedUserOperation = {
      sender: sender.address,
      nonce,
      initCode: deployed
        ? "0x"
        : encodeInitCode(factory, sender.signer.qx, sender.signer.qy, sender.signer.salt),
      callData: encodeBatchCall([encodeErc20Transfer(usdc, recipient, amount)]),
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
      digests: { permit, userOp: "0x" },
      userOp: serializeOp(op),
      fee: {
        asset: "USDC",
        maxBaseUnits: maxToken.toString(),
        estimateBaseUnits: estimateToken.toString(),
        tokenPerEth: tokenPerEth.toString(),
      },
      permit: {
        spender: paymaster,
        amount: permitAmount.toString(),
        nonce: permitNonce.toString(),
        deadline: PERMIT_DEADLINE.toString(),
      },
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  /** Step 2 of authorization: with the permit signature in place, the user-op hash becomes computable. */
  async userOpHash(
    draft: QuoteDraft,
    permitSignature: Hex,
  ): Promise<{ op: PackedUserOperation; hash: Hex }> {
    const op = {
      ...deserializeOp(draft.userOp),
      paymasterAndData: `${draft.userOp.paymasterAndData}${permitSignature.slice(2)}` as Hex,
    };
    const hash = await this.deps.l2.readContract({
      address: this.deps.entryPoint,
      abi: entryPointAbi,
      functionName: "getUserOpHash",
      args: [op],
    });
    return { op, hash };
  }

  /** Submit the fully signed operation through the paymaster. Returns inclusion data and the USDC fee actually charged. */
  async execute(
    op: PackedUserOperation,
    sender: Address,
    amountOut: bigint,
    tokenOut?: Address,
  ): Promise<{
    txHash: Hex;
    blockNumber: bigint;
    userOpHash: Hex;
    feeBaseUnits: bigint;
    receivedBaseUnits: bigint;
  }> {
    const { l2, bundler, entryPoint, usdc } = this.deps;
    const before = await l2.readContract({
      address: usdc,
      abi: testUSDCAbi,
      functionName: "balanceOf",
      args: [sender],
    });
    const outBefore = tokenOut
      ? await l2.readContract({
          address: tokenOut,
          abi: testUSDCAbi,
          functionName: "balanceOf",
          args: [sender],
        })
      : 0n;
    const [res] = await submitUserOps(bundler, l2, entryPoint, [op], bundler.account.address);
    if (!res) throw new Error("no UserOperationEvent in receipt");
    if (!res.success)
      throw new Error(`user operation ${res.userOpHash} reverted on chain (tx ${res.txHash})`);
    const after = await l2.readContract({
      address: usdc,
      abi: testUSDCAbi,
      functionName: "balanceOf",
      args: [sender],
    });
    const outAfter = tokenOut
      ? await l2.readContract({
          address: tokenOut,
          abi: testUSDCAbi,
          functionName: "balanceOf",
          args: [sender],
        })
      : 0n;
    return {
      txHash: res.txHash,
      blockNumber: res.blockNumber,
      userOpHash: res.userOpHash,
      feeBaseUnits: before - after - amountOut,
      receivedBaseUnits: outAfter - outBefore,
    };
  }

  async finality(
    blockNumber: bigint,
  ): Promise<{ state: "INCLUDED" | "FINALIZED" | "PENDING"; finalizedL2Block?: bigint }> {
    if (!this.deps.l1 || !this.deps.rollup) return { state: "INCLUDED" };
    const finalized = await readFinalizedL2Block(this.deps.l1, this.deps.rollup);
    return { state: finalityOf(blockNumber, finalized), finalizedL2Block: finalized };
  }

  /**
   * Deploy the passkey account now (idempotent on the factory). Counterfactual accounts cannot pass
   * ERC-1271 checks until they have code, and DvP settlement verifies both parties through ERC-1271.
   * ERC-6492 would avoid the deployment; adopting it is an open item in ADR-0008.
   */
  async deployAccount(qx: Hex, qy: Hex, salt: Hex): Promise<Address> {
    const address = await this.accountAddress(qx, qy, salt);
    const code = await this.deps.l2.getCode({ address });
    if (code && size(code) > 0) return address;
    const hash = await this.deps.bundler.writeContract({
      address: this.deps.factory,
      abi: passkeyAccountFactoryAbi,
      functionName: "createAccount",
      args: [qx, qy, salt],
    });
    const receipt = await this.deps.l2.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`account deployment reverted in ${hash}`);
    return address;
  }

  /** Counterfactual address for a new passkey account. */
  accountAddress(qx: Hex, qy: Hex, salt: Hex): Promise<Address> {
    return this.deps.l2.readContract({
      address: this.deps.factory,
      abi: passkeyAccountFactoryAbi,
      functionName: "getAddress",
      args: [qx, qy, salt],
    });
  }

  static usdcDecimals = USDC_DECIMALS;
  static get buildSignedUserOp() {
    return buildSignedUserOp;
  }
}
