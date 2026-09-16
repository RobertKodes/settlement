import { p256 } from "@noble/curves/p256";
import { bytesToHex, concatHex, type Hex, hexToBytes, pad, toHex } from "viem";

/**
 * A P-256 key pair standing in for a passkey (ADR-0008). In the browser the private key never leaves the
 * authenticator; this class exists for servers' tests and for tooling. Signatures are `r ‖ s` (64 bytes)
 * with low-s normalisation, which is what PasskeyAccount verifies.
 */
export class Passkey {
  private readonly priv: Uint8Array;

  constructor(privateKey: Hex | bigint) {
    this.priv =
      typeof privateKey === "bigint"
        ? hexToBytes(pad(toHex(privateKey), { size: 32 }))
        : hexToBytes(pad(privateKey, { size: 32 }));
  }

  static random(): Passkey {
    return new Passkey(bytesToHex(p256.utils.randomPrivateKey()));
  }

  /** Uncompressed public key split into the two 32-byte coordinates the account stores. */
  publicKey(): { qx: Hex; qy: Hex } {
    const pub = p256.getPublicKey(this.priv, false); // 0x04 ‖ x ‖ y
    return { qx: bytesToHex(pub.slice(1, 33)), qy: bytesToHex(pub.slice(33, 65)) };
  }

  /** Sign a 32-byte digest (no hashing here). */
  sign(digest: Hex): Hex {
    const sig = p256.sign(hexToBytes(digest), this.priv, { lowS: true, prehash: false });
    return concatHex([pad(toHex(sig.r), { size: 32 }), pad(toHex(sig.s), { size: 32 })]);
  }

  static verify(digest: Hex, signature: Hex, pub: { qx: Hex; qy: Hex }): boolean {
    const sigBytes = hexToBytes(signature);
    const pubBytes = hexToBytes(concatHex(["0x04", pub.qx, pub.qy]));
    return p256.verify(sigBytes, hexToBytes(digest), pubBytes, { lowS: true, prehash: false });
  }
}
