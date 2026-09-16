import type { CctpDomain } from "@settlement/config";
import type {
  BurnIntent,
  Eip712TypedData,
  GatewayAttestation,
  GatewayBalance,
  GatewayClient,
} from "./types.js";

export class InMemoryGatewayClient implements GatewayClient {
  private readonly balances = new Map<string, bigint>();
  readonly mints: GatewayAttestation[] = [];
  private seq = 0;

  deposit(depositor: `0x${string}`, domain: CctpDomain, amount: bigint): void {
    const k = `${depositor}:${domain}`;
    this.balances.set(k, (this.balances.get(k) ?? 0n) + amount);
  }

  async getBalances(
    depositor: `0x${string}`,
    domains: readonly CctpDomain[],
  ): Promise<GatewayBalance[]> {
    return domains.map((domain) => {
      const total = this.balances.get(`${depositor}:${domain}`) ?? 0n;
      return { domain, total, available: total, withdrawing: 0n };
    });
  }

  buildBurnIntent(intent: BurnIntent): Eip712TypedData {
    return {
      domain: { name: "GatewayWallet", version: "1" },
      types: {
        BurnIntent: [
          { name: "sourceDomain", type: "uint32" },
          { name: "destinationDomain", type: "uint32" },
          { name: "depositor", type: "address" },
          { name: "recipient", type: "address" },
          { name: "destinationCaller", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "maxFee", type: "uint256" },
          { name: "validUntil", type: "uint256" },
          { name: "salt", type: "bytes32" },
        ],
      },
      primaryType: "BurnIntent",
      message: { ...intent, amount: intent.amount.toString(), maxFee: intent.maxFee.toString() },
    };
  }

  async submitBurnIntents(
    intents: Array<{ intent: BurnIntent; signature: `0x${string}` }>,
  ): Promise<GatewayAttestation[]> {
    if (intents.length === 0 || intents.length > 16)
      throw new Error("1..16 burn intents per request");
    return intents.map(({ intent }) => {
      const k = `${intent.depositor}:${intent.sourceDomain}`;
      const bal = this.balances.get(k) ?? 0n;
      if (bal < intent.amount + intent.maxFee)
        throw new Error(`insufficient Gateway balance on domain ${intent.sourceDomain}`);
      this.balances.set(k, bal - intent.amount - intent.maxFee);
      const id = `gw_${this.seq++}`;
      return {
        transferId: id,
        attestation: `0x${"aa".repeat(32)}`,
        signature: `0x${"bb".repeat(65)}`,
        destinationDomain: intent.destinationDomain,
      };
    });
  }

  async mint(att: GatewayAttestation): Promise<{ txHash: `0x${string}` }> {
    this.mints.push(att);
    return { txHash: `0x${this.mints.length.toString(16).padStart(64, "0")}` };
  }
}
