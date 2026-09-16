/** CCTP V2 constants (ADR-0017). V1 is legacy and must not be built against. */

export const CCTP_DOMAINS = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  solana: 5,
  base: 6,
  polygon: 7,
  unichain: 10,
  linea: 11,
  codex: 12,
  sonic: 13,
  worldchain: 14,
  sei: 16,
  hyperevm: 19,
  arc: 26,
} as const;
export type CctpDomainName = keyof typeof CCTP_DOMAINS;
export type CctpDomain = (typeof CCTP_DOMAINS)[CctpDomainName];

/**
 * `minFinalityThreshold` is the single knob selecting the transfer class: <= 1000 is Fast (attested in
 * seconds, charges an onchain fee that `maxFee` must cover), >= 2000 is Standard (hard finality, no fee).
 */
export const FinalityThreshold = { FAST: 1000, STANDARD: 2000 } as const;
export type FinalityThresholdName = keyof typeof FinalityThreshold;

/** Attestation service. V2 endpoint: GET {base}/v2/messages/{sourceDomain}?transactionHash=0x… */
export const IRIS_API = {
  mainnet: "https://iris-api.circle.com",
  sandbox: "https://iris-api-sandbox.circle.com",
} as const;

export function irisMessagesUrl(base: string, sourceDomain: number, txHash: `0x${string}`): string {
  return `${base}/v2/messages/${sourceDomain}?transactionHash=${txHash}`;
}

/** Canonical TokenMessengerV2 addresses (uniform across most EVM chains; always confirm per chain). */
export const TOKEN_MESSENGER_V2 = {
  mainnet: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  testnet: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
} as const;
