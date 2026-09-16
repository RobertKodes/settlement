/** Live read-only checks against Arc Testnet. Run with ARC=1 (needs internet). */
import { describe, expect, it } from "vitest";
import { ARC, ArcRpcAdapter } from "../src/rpc.js";

describe.skipIf(process.env.ARC !== "1")("Arc Testnet (live, read-only)", () => {
  it("answers with chain 5042002 and reads USDC balances through the ERC-20 view", async () => {
    const arc = new ArcRpcAdapter({ network: "testnet" });
    expect(await arc.client.getChainId()).toBe(ARC.testnet.chainId);
    const b = await arc.getUsdcBalance("0x0000000000000000000000000000000000000001");
    expect(typeof b.erc20Units).toBe("bigint");
    const n = await arc.getNativeBalance("0x0000000000000000000000000000000000000001");
    expect(n.erc20Units).toBe(n.wei / 10n ** 12n);
  }, 30_000);
});
