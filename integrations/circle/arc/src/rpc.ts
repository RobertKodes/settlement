import { type PublicClient, publicClient } from "@settlement/chain";
import { venueRouterAbi } from "@settlement/contracts-abi";
import { type Address, erc20Abi } from "viem";
import { arcNativeToErc20Units } from "./decimals.js";
import type { ArcAdapter, ArcFxQuote, ArcUsdcBalance } from "./types.js";

/** Arc Testnet/Mainnet facts (docs.arc.io, 2026-09-16). USDC's ERC-20 view is the same address on both. */
export const ARC = {
  testnet: {
    chainKey: "arc-testnet" as const,
    chainId: 5042002,
    rpc: "https://rpc.testnet.arc.io",
    explorer: "https://explorer.testnet.arc.io",
    usdc: "0x3600000000000000000000000000000000000000" as Address,
    eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address,
    fxEscrow: "0xe2E5F173576B513d994073CCbDaCBE027d43DFe6" as Address,
  },
  mainnet: {
    chainKey: "arc-mainnet" as const,
    chainId: 5042,
    rpc: "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    usdc: "0x3600000000000000000000000000000000000000" as Address,
    eurc: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as Address,
    fxEscrow: "0xe2E5F173576B513d994073CCbDaCBE027d43DFe6" as Address,
  },
};

export interface ArcRpcConfig {
  network: keyof typeof ARC;
  rpcUrl?: string;
  /** Our VenueRouter on Arc once `make arc-deploy` has run; without it `quoteFx` uses only StableFX (BLOCKED) → undefined. */
  venueRouter?: Address;
}

/**
 * Real Arc adapter over JSON-RPC: balances through the ERC-20 view (6 decimals) and, separately, the native
 * balance (18 decimals) so the two are never mixed; FX quotes from our own venue on Arc when deployed.
 * StableFX quotes need Circle's institutional API key and stay in the mock until then (ADR-0018).
 */
export class ArcRpcAdapter implements ArcAdapter {
  readonly client: PublicClient;
  readonly net: (typeof ARC)[keyof typeof ARC];
  constructor(private readonly cfg: ArcRpcConfig) {
    this.net = ARC[cfg.network];
    this.client = publicClient(this.net.chainKey, cfg.rpcUrl ?? this.net.rpc);
  }

  async getUsdcBalance(address: Address): Promise<ArcUsdcBalance> {
    const erc20 = await this.client.readContract({
      address: this.net.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    return { erc20Units: erc20 };
  }

  /** Native (gas) balance in 18-decimal units, and the same value in 6-decimal ERC-20 units for display. */
  async getNativeBalance(address: Address): Promise<{ wei: bigint; erc20Units: bigint }> {
    const wei = await this.client.getBalance({ address });
    return { wei, erc20Units: arcNativeToErc20Units(wei) };
  }

  async getEurcBalance(address: Address): Promise<bigint> {
    return this.client.readContract({
      address: this.net.eurc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
  }

  async quoteFx(params: {
    from: "USDC" | "EURC";
    to: "USDC" | "EURC";
    amountIn: bigint;
  }): Promise<ArcFxQuote | undefined> {
    if (params.from === params.to || !this.cfg.venueRouter) return undefined;
    const path = [
      params.from === "USDC" ? this.net.usdc : this.net.eurc,
      params.to === "USDC" ? this.net.usdc : this.net.eurc,
    ] as const;
    try {
      const amounts = await this.client.readContract({
        address: this.cfg.venueRouter,
        abi: venueRouterAbi,
        functionName: "getAmountsOut",
        args: [params.amountIn, [...path]],
      });
      return {
        ...params,
        amountOut: amounts[1] ?? 0n,
        validUntil: Math.floor(Date.now() / 1000) + 30,
        venue: "arc-rfq",
      };
    } catch {
      return undefined;
    }
  }
}
