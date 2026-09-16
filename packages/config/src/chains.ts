/**
 * Chain registry. Facts verified 2026-09-16 against Circle and Lineth documentation; see ADR-0002,
 * ADR-0017, ADR-0018. Every asset carries its own decimals per chain — there is deliberately no
 * global `USDC = 6` constant, because Arc's native gas USDC has 18 decimals while the ERC-20 view of
 * the same balance has 6.
 */

export type ChainKind = "l1" | "l2" | "arc" | "external";
export type Environment = "local" | "testnet" | "mainnet";

export interface AssetRef {
  /** Contract address, or "native" for the chain's gas asset. */
  readonly address: `0x${string}` | "native";
  readonly decimals: number;
}

export interface ChainInfo {
  readonly key: ChainKey;
  readonly chainId: number;
  readonly name: string;
  readonly kind: ChainKind;
  readonly environment: Environment;
  readonly rpcUrl: string;
  readonly explorerUrl?: string;
  readonly nativeCurrency: { readonly symbol: string; readonly decimals: number };
  /** CCTP V2 domain, when Circle supports the chain. Absent on our own chain until Circle does (ADR-0017). */
  readonly cctpDomain?: number;
  readonly assets: Readonly<Partial<Record<"USDC" | "EURC", AssetRef>>>;
  readonly notes?: readonly string[];
}

export const CHAIN_KEYS = [
  "l2-devnet",
  "l1-local",
  "ethereum-sepolia",
  "ethereum-mainnet",
  "base",
  "linea",
  "arc-testnet",
  "arc-mainnet",
] as const;
export type ChainKey = (typeof CHAIN_KEYS)[number];

export const CHAINS: Readonly<Record<ChainKey, ChainInfo>> = {
  "l2-devnet": {
    key: "l2-devnet",
    chainId: 1337,
    name: "Settlement network — local devnet",
    kind: "l2",
    environment: "local",
    rpcUrl: "http://localhost:8645",
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    assets: {},
    notes: [
      "Chain ID 1337 is temporary (ADR-0002); the Lineth quickstart pins it in three genesis/prover files.",
      "No USDC until Circle supports the chain; Phase 2 uses a bridged test representation (ADR-0007).",
    ],
  },
  "l1-local": {
    key: "l1-local",
    chainId: 31648428,
    name: "Local L1 (Besu + Teku, Lineth quickstart)",
    kind: "l1",
    environment: "local",
    rpcUrl: "http://localhost:8445",
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    assets: {},
  },
  "ethereum-sepolia": {
    key: "ethereum-sepolia",
    chainId: 11155111,
    name: "Ethereum Sepolia",
    kind: "l1",
    environment: "testnet",
    rpcUrl: "https://rpc.sepolia.org",
    explorerUrl: "https://sepolia.etherscan.io",
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    cctpDomain: 0,
    assets: {
      USDC: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
      EURC: { address: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4", decimals: 6 },
    },
  },
  "ethereum-mainnet": {
    key: "ethereum-mainnet",
    chainId: 1,
    name: "Ethereum",
    kind: "l1",
    environment: "mainnet",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    explorerUrl: "https://etherscan.io",
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    cctpDomain: 0,
    assets: {
      USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      EURC: { address: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c", decimals: 6 },
    },
  },
  base: {
    key: "base",
    chainId: 8453,
    name: "Base",
    kind: "external",
    environment: "mainnet",
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    cctpDomain: 6,
    assets: { USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 } },
  },
  linea: {
    key: "linea",
    chainId: 59144,
    name: "Linea",
    kind: "external",
    environment: "mainnet",
    rpcUrl: "https://rpc.linea.build",
    explorerUrl: "https://lineascan.build",
    nativeCurrency: { symbol: "ETH", decimals: 18 },
    cctpDomain: 11,
    assets: { USDC: { address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", decimals: 6 } },
    notes: [
      "CCTP Standard transfers from Linea wait for L1 finality and are materially slower than other L2s.",
    ],
  },
  "arc-testnet": {
    key: "arc-testnet",
    chainId: 5042002,
    name: "Arc Testnet",
    kind: "arc",
    environment: "testnet",
    rpcUrl: "https://rpc.testnet.arc.io",
    explorerUrl: "https://explorer.testnet.arc.io",
    nativeCurrency: { symbol: "USDC", decimals: 18 },
    cctpDomain: 26,
    assets: {
      USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
      EURC: { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6 },
    },
    notes: [
      "Native gas USDC is 18 decimals; the ERC-20 interface at 0x3600…0000 is 6 decimals (ADR-0018).",
    ],
  },
  "arc-mainnet": {
    key: "arc-mainnet",
    chainId: 5042,
    name: "Arc",
    kind: "arc",
    environment: "mainnet",
    rpcUrl: "https://rpc.mainnet.arc.io",
    explorerUrl: "https://explorer.arc.io",
    nativeCurrency: { symbol: "USDC", decimals: 18 },
    cctpDomain: 26,
    assets: {
      USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
      EURC: { address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", decimals: 6 },
    },
    notes: [
      "Native gas USDC is 18 decimals; the ERC-20 interface at 0x3600…0000 is 6 decimals (ADR-0018).",
    ],
  },
};

export function chainById(chainId: number): ChainInfo | undefined {
  return Object.values(CHAINS).find((c) => c.chainId === chainId);
}

export function chainByCctpDomain(domain: number): ChainInfo | undefined {
  return Object.values(CHAINS).find((c) => c.cctpDomain === domain);
}

/** Decimals for (asset, chain). Throws rather than guessing, on purpose. */
export function assetDecimals(key: ChainKey, asset: "USDC" | "EURC"): number {
  const ref = CHAINS[key].assets[asset];
  if (!ref) throw new Error(`${asset} is not registered on ${key}`);
  return ref.decimals;
}
