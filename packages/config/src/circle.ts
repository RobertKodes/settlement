/** Circle and fiat-provider service endpoints (ADR-0017, ADR-0018, ADR-0019). */

export const GATEWAY_API = {
  mainnet: "https://gateway-api.circle.com/v1",
  testnet: "https://gateway-api-testnet.circle.com/v1",
} as const;

/** GatewayWallet on every EVM testnet. Mainnet + GatewayMinter come from Circle's contract-addresses page. */
export const GATEWAY_WALLET_TESTNET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;

/** Circle Paymaster (ERC-4337 only). Uniform per EntryPoint version per environment. */
export const CIRCLE_PAYMASTER = {
  "v0.7": {
    mainnet: "0x6C973eBe80dCD8660841D4356bf15c32460271C9",
    testnet: "0x31BE08D380A21fc740883c0BC434FcFc88740b58",
  },
  "v0.8": {
    mainnet: "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
    testnet: "0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966",
  },
} as const;

export const CIRCLE_FAUCET_URL = "https://faucet.circle.com" as const;

export const BRIDGE_API = {
  sandbox: "https://api.sandbox.bridge.xyz/v0",
  production: "https://api.bridge.xyz/v0",
} as const;
