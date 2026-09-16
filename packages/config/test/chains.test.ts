import { describe, expect, it } from "vitest";
import { CCTP_DOMAINS, FinalityThreshold, irisMessagesUrl } from "../src/cctp.js";
import { assetDecimals, CHAIN_KEYS, CHAINS, chainByCctpDomain, chainById } from "../src/chains.js";
import { loadEnv } from "../src/env.js";

describe("chain registry", () => {
  it("has unique chain IDs", () => {
    const ids = CHAIN_KEYS.map((k) => CHAINS[k].chainId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps each CCTP domain to at most one chain per environment", () => {
    const seen = new Map<string, string>();
    for (const k of CHAIN_KEYS) {
      const c = CHAINS[k];
      if (c.cctpDomain === undefined) continue;
      const key = `${c.cctpDomain}:${c.environment}`;
      expect(seen.has(key), `${key} already used by ${seen.get(key)}`).toBe(false);
      seen.set(key, k);
    }
  });

  it("keeps decimals chain-scoped: Arc native USDC is 18, ERC-20 USDC is 6", () => {
    expect(CHAINS["arc-mainnet"].nativeCurrency).toEqual({ symbol: "USDC", decimals: 18 });
    expect(assetDecimals("arc-mainnet", "USDC")).toBe(6);
    expect(assetDecimals("ethereum-sepolia", "USDC")).toBe(6);
    expect(() => assetDecimals("l2-devnet", "USDC")).toThrow(/not registered/);
  });

  it("agrees with the Circle domain table", () => {
    expect(CHAINS.linea.cctpDomain).toBe(CCTP_DOMAINS.linea);
    expect(CHAINS["arc-mainnet"].cctpDomain).toBe(CCTP_DOMAINS.arc);
    expect(chainByCctpDomain(6)?.key).toBe("base");
    expect(chainById(1337)?.key).toBe("l2-devnet");
    expect(CHAINS["l2-devnet"].cctpDomain).toBeUndefined();
  });

  it("builds the V2 attestation URL", () => {
    expect(irisMessagesUrl("https://iris-api-sandbox.circle.com", 0, "0xabc")).toBe(
      "https://iris-api-sandbox.circle.com/v2/messages/0?transactionHash=0xabc",
    );
    expect(FinalityThreshold.FAST).toBeLessThan(FinalityThreshold.STANDARD);
  });
});

describe("env", () => {
  it("defaults to the local devnet", () => {
    const env = loadEnv({});
    expect(env.L2_CHAIN_ID).toBe(1337);
    expect(env.L1_CHAIN_ID).toBe(31648428);
  });
  it("rejects a malformed RPC URL", () => {
    expect(() => loadEnv({ L2_RPC_URL: "not a url" })).toThrow();
  });
});
