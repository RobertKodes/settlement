import { type CctpDomain, FinalityThreshold } from "@settlement/config";
import type { CctpClient, CctpMessage, DepositForBurnParams } from "./types.js";

/** Records every call and attests immediately. For unit tests of the router/reconciler, not for integration. */
export class InMemoryCctpClient implements CctpClient {
  readonly burns: Array<{ params: DepositForBurnParams; txHash: `0x${string}` }> = [];
  readonly receipts: Array<{
    destinationDomain: CctpDomain;
    message: `0x${string}`;
    txHash: `0x${string}`;
  }> = [];
  private nonce = 0;

  constructor(private readonly sourceDomain: CctpDomain) {}

  async depositForBurn(params: DepositForBurnParams): Promise<{ txHash: `0x${string}` }> {
    if (params.amount <= 0n) throw new Error("amount must be positive");
    if (params.minFinalityThreshold <= FinalityThreshold.FAST && params.maxFee === 0n) {
      throw new Error("Fast transfers require maxFee >= getMinFeeAmount(amount)");
    }
    const txHash = fakeHash(`burn:${this.nonce++}`);
    this.burns.push({ params, txHash });
    return { txHash };
  }

  async fetchMessage(
    sourceDomain: CctpDomain,
    txHash: `0x${string}`,
  ): Promise<CctpMessage | undefined> {
    const burn = this.burns.find((b) => b.txHash === txHash);
    if (!burn || sourceDomain !== this.sourceDomain) return undefined;
    return {
      status: "complete",
      sourceDomain,
      destinationDomain: burn.params.destinationDomain,
      eventNonce: String(this.burns.indexOf(burn)),
      message: fakeHash(`msg:${txHash}`),
      attestation: fakeHash(`att:${txHash}`),
    };
  }

  async receiveMessage(
    destinationDomain: CctpDomain,
    message: `0x${string}`,
    attestation: `0x${string}`,
  ): Promise<{ txHash: `0x${string}` }> {
    if (!attestation.startsWith("0x")) throw new Error("attestation must be hex");
    const txHash = fakeHash(`recv:${message}`);
    this.receipts.push({ destinationDomain, message, txHash });
    return { txHash };
  }
}

function fakeHash(seed: string): `0x${string}` {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `0x${h.toString(16).padStart(8, "0").repeat(8)}`;
}
