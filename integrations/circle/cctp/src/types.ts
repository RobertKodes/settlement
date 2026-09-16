import type { CctpDomain } from "@settlement/config";

/**
 * CCTP V2 (ADR-0017). Parameter names mirror `TokenMessengerV2.depositForBurn` one-to-one so the
 * onchain adapter is a straight encode; nothing here is V1-compatible on purpose.
 */
export interface DepositForBurnParams {
  /** Base units of `burnToken` (USDC: 6 decimals on every CCTP chain). */
  amount: bigint;
  destinationDomain: CctpDomain;
  /** bytes32-padded recipient on the destination chain. */
  mintRecipient: `0x${string}`;
  burnToken: `0x${string}`;
  /** bytes32 caller allowed to call receiveMessage on the destination; zero = anyone. Set it to stop front-running. */
  destinationCaller: `0x${string}`;
  /** Must cover `getMinFeeAmount(amount)` for Fast; may be 0 for Standard. */
  maxFee: bigint;
  /** <= 1000 Fast, >= 2000 Standard. Use `FinalityThreshold` from @settlement/config. */
  minFinalityThreshold: number;
  /** Metadata only: CCTP does not execute hooks, the destination contract interprets it. */
  hookData?: `0x${string}`;
}

export type AttestationStatus = "pending_confirmations" | "complete";

/** Shape of one entry from GET /v2/messages/{domain}?transactionHash=. `attestation` is "PENDING" until complete. */
export interface CctpMessage {
  status: AttestationStatus;
  sourceDomain: CctpDomain;
  destinationDomain: CctpDomain;
  eventNonce: string;
  message: `0x${string}`;
  attestation: `0x${string}` | "PENDING";
  decodedMessage?: Record<string, unknown>;
}

export interface CctpClient {
  /** Burn on the source chain. Resolves with the source tx hash once mined. */
  depositForBurn(params: DepositForBurnParams): Promise<{ txHash: `0x${string}` }>;
  /** Poll the attestation service for the burn's message. */
  fetchMessage(sourceDomain: CctpDomain, txHash: `0x${string}`): Promise<CctpMessage | undefined>;
  /** Submit (message, attestation) to MessageTransmitterV2.receiveMessage on the destination chain. */
  receiveMessage(
    destinationDomain: CctpDomain,
    message: `0x${string}`,
    attestation: `0x${string}`,
  ): Promise<{ txHash: `0x${string}` }>;
}
