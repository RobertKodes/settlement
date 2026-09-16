import { size, sliceHex } from "viem";
import { describe, expect, it } from "vitest";
import { finalityOf } from "../src/finality.js";
import { Passkey } from "../src/passkey.js";
import {
  ERC7821_MODE_BATCH,
  encodeBatchCall,
  encodeErc20Transfer,
  encodePaymasterAndData,
  packUint128Pair,
  permitDigest,
} from "../src/userop.js";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;

describe("passkey", () => {
  it("signs low-s 64-byte signatures that verify", () => {
    const k = new Passkey(0x5eedc0ffeen);
    const digest = `0x${"ab".repeat(32)}` as const;
    const sig = k.sign(digest);
    expect(size(sig)).toBe(64);
    const s = BigInt(sliceHex(sig, 32, 64));
    expect(s).toBeLessThanOrEqual(
      0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n / 2n,
    );
    expect(Passkey.verify(digest, sig, k.publicKey())).toBe(true);
    expect(Passkey.verify(`0x${"cd".repeat(32)}`, sig, k.publicKey())).toBe(false);
  });
  it("derives the same public key Foundry's vm.publicKeyP256 does for the test key", () => {
    // qx/qy for private key 0x5eedc0ffee, as logged by the MilestoneC script's initCode (factory createAccount args).
    const { qx, qy } = new Passkey(0x5eedc0ffeen).publicKey();
    expect(qx).toBe("0xc3b88b1f5122f522f6f924f551d5f87c1d1acae16a3d8b40d7033503ede99185");
    expect(qy).toBe("0xa31df80211696d9d8f8b2ffa3f0d2bea4cc4317b76f71b422252433d08c51216");
  });
});

describe("user-op encoding", () => {
  it("packs two uint128 into bytes32", () => {
    expect(packUint128Pair(1n, 2n)).toBe(`0x${"0".repeat(31)}1${"0".repeat(31)}2`);
  });
  it("lays paymasterAndData out at the USDCPaymaster offsets (52 mode, 53 token, 73 amount, 105 sig)", () => {
    const sig = `0x${"11".repeat(64)}` as const;
    const data = encodePaymasterAndData({
      paymaster: addr(1),
      verificationGasLimit: 900_000n,
      postOpGasLimit: 60_000n,
      token: addr(2),
      permitAmount: 50_000_000n,
      permitSignature: sig,
    });
    expect(size(data)).toBe(169);
    expect(sliceHex(data, 52, 53)).toBe("0x00");
    expect(sliceHex(data, 53, 73)).toBe(addr(2));
    expect(BigInt(sliceHex(data, 73, 105))).toBe(50_000_000n);
    expect(sliceHex(data, 105)).toBe(sig);
  });
  it("encodes an ERC-7821 batch call in batch mode", () => {
    const call = encodeBatchCall([encodeErc20Transfer(addr(2), addr(3), 250_000_000n)]);
    expect(call.startsWith("0xe9ae5c53")).toBe(true); // execute(bytes32,bytes)
    expect(sliceHex(call, 4, 36)).toBe(ERC7821_MODE_BATCH);
  });
  it("permit digest is deterministic and domain-bound", () => {
    const base = {
      chainId: 1337,
      token: addr(2),
      tokenName: "USD Coin (devnet test)",
      owner: addr(4),
      spender: addr(1),
      value: 50_000_000n,
      nonce: 0n,
    };
    expect(permitDigest(base)).toBe(permitDigest({ ...base }));
    expect(permitDigest(base)).not.toBe(permitDigest({ ...base, chainId: 5042 }));
  });
});

describe("finality", () => {
  it("maps block positions to receipt states", () => {
    expect(finalityOf(undefined, 10n)).toBe("PENDING");
    expect(finalityOf(12n, 10n)).toBe("INCLUDED");
    expect(finalityOf(10n, 10n)).toBe("FINALIZED");
  });
});
