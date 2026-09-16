import { CHAINS, type ChainKey } from "@settlement/config";
import {
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  type Transport,
  type PublicClient as ViemPublicClient,
  type WalletClient as ViemWalletClient,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";

/** Explicit client types: viem's inferred ones are not portable across workspace packages (TS2742). */
export type PublicClient = ViemPublicClient<Transport, Chain>;
export type WalletClient = ViemWalletClient<Transport, Chain, PrivateKeyAccount>;

/** viem `Chain` from the registry entry; `rpcUrl` overrides the registry default (e.g. a container-internal URL). */
export function toViemChain(key: ChainKey, rpcUrl?: string): Chain {
  const c = CHAINS[key];
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: {
      name: c.nativeCurrency.symbol,
      symbol: c.nativeCurrency.symbol,
      decimals: c.nativeCurrency.decimals,
    },
    rpcUrls: { default: { http: [rpcUrl ?? c.rpcUrl] } },
  });
}

export function publicClient(key: ChainKey, rpcUrl?: string): PublicClient {
  const chain = toViemChain(key, rpcUrl);
  return createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
}

export function walletClient(key: ChainKey, privateKey: Hex, rpcUrl?: string): WalletClient {
  const chain = toViemChain(key, rpcUrl);
  return createWalletClient({
    chain,
    account: privateKeyToAccount(privateKey),
    transport: http(chain.rpcUrls.default.http[0]),
  });
}
