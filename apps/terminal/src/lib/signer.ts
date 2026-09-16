import { Passkey } from "@settlement/chain";

/**
 * Device keys for the devnet: P-256 private keys kept in localStorage, one per account handle created in
 * this browser. This is the passkey's key pair without the authenticator. WebAuthn replaces it (ADR-0008);
 * the rest of the app only ever calls `sign(digest)`.
 */
const KEY = "terminal.devicekeys.v1";

interface Stored {
  handle: string;
  priv: `0x${string}`;
  accountId: string;
  address: `0x${string}`;
}

function load(): Stored[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Stored[];
  } catch {
    return [];
  }
}
function save(list: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

export const deviceKeys = {
  list: (): Stored[] => load(),
  get: (handle: string): Stored | undefined => load().find((s) => s.handle === handle),
  create(): { passkey: Passkey; priv: `0x${string}` } {
    const passkey = Passkey.random();
    // recover the private key hex through the constructor's contract: keep it here as the only owner
    const priv = (passkey as unknown as { priv: Uint8Array }).priv;
    return {
      passkey,
      priv: `0x${Array.from(priv, (b) => b.toString(16).padStart(2, "0")).join("")}`,
    };
  },
  remember(rec: Stored) {
    const list = load().filter((s) => s.handle !== rec.handle);
    list.push(rec);
    save(list);
  },
  signer(handle: string): Passkey | undefined {
    const s = load().find((x) => x.handle === handle);
    return s ? new Passkey(s.priv) : undefined;
  },
};
