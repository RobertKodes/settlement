import type { CctpDomain } from "@settlement/config";

/**
 * Circle Gateway (ADR-0017): a unified USDC balance across chains, minted on the destination in
 * under a second. Flow: deposit into GatewayWallet -> sign a burn intent (EIP-712) -> POST /v1/transfer
 * -> gatewayMint(attestation, signature) on the destination. Burn intents must be signed by an EOA
 * on EVM today; a smart-account signer will not be accepted (see docs on the interface below).
 * Never plain-transfer USDC to GatewayWallet: funds are lost.
 */
export interface GatewayBalance {
  domain: CctpDomain;
  /** Base units (6 decimals). */
  total: bigint;
  available: bigint;
  withdrawing: bigint;
}

export interface BurnIntent {
  sourceDomain: CctpDomain;
  destinationDomain: CctpDomain;
  depositor: `0x${string}`;
  recipient: `0x${string}`;
  /** Set to the contract that will call gatewayMint to prevent front-running. */
  destinationCaller: `0x${string}`;
  amount: bigint;
  maxFee: bigint;
  /** Unix seconds. */
  validUntil: number;
  salt: `0x${string}`;
}

export interface Eip712TypedData {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface GatewayAttestation {
  transferId: string;
  attestation: `0x${string}`;
  signature: `0x${string}`;
  destinationDomain: CctpDomain;
}

export interface GatewayClient {
  getBalances(depositor: `0x${string}`, domains: readonly CctpDomain[]): Promise<GatewayBalance[]>;
  /** Pure: builds the typed data the (EOA) depositor must sign. */
  buildBurnIntent(intent: BurnIntent): Eip712TypedData;
  /** POST /v1/transfer with up to 16 signed intents; returns one attestation per destination. */
  submitBurnIntents(
    intents: Array<{ intent: BurnIntent; signature: `0x${string}` }>,
  ): Promise<GatewayAttestation[]>;
  /** Call GatewayMinter.gatewayMint on the destination chain. */
  mint(att: GatewayAttestation): Promise<{ txHash: `0x${string}` }>;
}
