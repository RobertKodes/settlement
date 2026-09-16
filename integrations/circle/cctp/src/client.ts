import type { PublicClient, WalletClient } from "@settlement/chain";
import {
  CCTP_DOMAINS,
  type CctpDomain,
  IRIS_API,
  irisMessagesUrl,
  TOKEN_MESSENGER_V2,
} from "@settlement/config";
import { type Address, erc20Abi, type Hex, pad } from "viem";
import type { CctpClient, CctpMessage, DepositForBurnParams } from "./types.js";

const tokenMessengerV2Abi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getMinFeeAmount",
    stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const messageTransmitterV2Abi = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** Testnet MessageTransmitterV2 is uniform across EVM testnets (Circle docs); mainnet addresses differ per chain. */
export const MESSAGE_TRANSMITTER_V2_TESTNET: Address = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";

export interface CctpChain {
  domain: CctpDomain;
  client: PublicClient;
  wallet?: WalletClient;
  usdc: Address;
  tokenMessenger?: Address;
  messageTransmitter?: Address;
}

/** Real CCTP V2 client: burn on the source chain, poll IRIS, mint on the destination. Sandbox by default. */
export class CctpV2Client implements CctpClient {
  constructor(
    private readonly chains: Partial<Record<CctpDomain, CctpChain>>,
    private readonly iris: string = IRIS_API.sandbox,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private chain(domain: CctpDomain): CctpChain {
    const c = this.chains[domain];
    if (!c) throw new Error(`CCTP domain ${domain} not configured`);
    return c;
  }

  async depositForBurn(p: DepositForBurnParams): Promise<{ txHash: Hex }> {
    const src = Object.values(this.chains).find(
      (c) => c?.usdc.toLowerCase() === p.burnToken.toLowerCase(),
    );
    if (!src?.wallet) throw new Error("no wallet configured for the burn token's chain");
    const messenger = src.tokenMessenger ?? TOKEN_MESSENGER_V2.testnet;
    const approve = await src.wallet.writeContract({
      address: p.burnToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [messenger, p.amount],
    });
    await src.client.waitForTransactionReceipt({ hash: approve });
    const txHash = p.hookData
      ? await src.wallet.writeContract({
          address: messenger,
          abi: tokenMessengerV2Abi,
          functionName: "depositForBurnWithHook",
          args: [
            p.amount,
            p.destinationDomain,
            p.mintRecipient,
            p.burnToken,
            p.destinationCaller,
            p.maxFee,
            p.minFinalityThreshold,
            p.hookData,
          ],
        })
      : await src.wallet.writeContract({
          address: messenger,
          abi: tokenMessengerV2Abi,
          functionName: "depositForBurn",
          args: [
            p.amount,
            p.destinationDomain,
            p.mintRecipient,
            p.burnToken,
            p.destinationCaller,
            p.maxFee,
            p.minFinalityThreshold,
          ],
        });
    await src.client.waitForTransactionReceipt({ hash: txHash });
    return { txHash };
  }

  async fetchMessage(sourceDomain: CctpDomain, txHash: Hex): Promise<CctpMessage | undefined> {
    const res = await this.fetchImpl(irisMessagesUrl(this.iris, sourceDomain, txHash));
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`iris ${res.status}`);
    const json = (await res.json()) as {
      messages?: Array<{
        status: string;
        sourceDomainId?: string;
        destinationDomainId?: string;
        eventNonce: string;
        message: Hex;
        attestation: Hex | "PENDING";
        decodedMessage?: Record<string, unknown>;
      }>;
    };
    const m = json.messages?.[0];
    if (!m) return undefined;
    return {
      status: m.attestation === "PENDING" ? "pending_confirmations" : "complete",
      sourceDomain,
      destinationDomain: Number(
        m.destinationDomainId ?? m.decodedMessage?.destinationDomain ?? 0,
      ) as CctpDomain,
      eventNonce: m.eventNonce,
      message: m.message,
      attestation: m.attestation,
      ...(m.decodedMessage ? { decodedMessage: m.decodedMessage } : {}),
    };
  }

  /** Poll until attested. Fast transfers complete in seconds; Standard waits for source-chain finality. */
  async waitForAttestation(
    sourceDomain: CctpDomain,
    txHash: Hex,
    opts: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<CctpMessage> {
    const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60_000);
    for (;;) {
      const m = await this.fetchMessage(sourceDomain, txHash);
      if (m?.status === "complete") return m;
      if (Date.now() > deadline)
        throw new Error(`attestation for ${txHash} not complete after timeout`);
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 3_000));
    }
  }

  async receiveMessage(
    destinationDomain: CctpDomain,
    message: Hex,
    attestation: Hex,
  ): Promise<{ txHash: Hex }> {
    const dst = this.chain(destinationDomain);
    if (!dst.wallet) throw new Error(`no wallet configured for domain ${destinationDomain}`);
    const txHash = await dst.wallet.writeContract({
      address: dst.messageTransmitter ?? MESSAGE_TRANSMITTER_V2_TESTNET,
      abi: messageTransmitterV2Abi,
      functionName: "receiveMessage",
      args: [message, attestation],
    });
    await dst.client.waitForTransactionReceipt({ hash: txHash });
    return { txHash };
  }

  async minFee(sourceDomain: CctpDomain, amount: bigint): Promise<bigint> {
    const src = this.chain(sourceDomain);
    return src.client.readContract({
      address: src.tokenMessenger ?? TOKEN_MESSENGER_V2.testnet,
      abi: tokenMessengerV2Abi,
      functionName: "getMinFeeAmount",
      args: [amount],
    });
  }
}

export const toBytes32Address = (a: Address): Hex => pad(a, { size: 32 });
export { CCTP_DOMAINS };
