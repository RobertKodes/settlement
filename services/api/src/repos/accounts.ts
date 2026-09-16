import { createHash } from "node:crypto";
import type { Address, Hex } from "viem";
import type { Db } from "../db.js";
import { errors } from "../errors.js";

/** Product account bound to a passkey wallet whose L2 address is counterfactual (blueprint section 6, ADR-0008). */
export interface AccountRecord {
  accountId: string; // uuid
  handle: string;
  kind: "consumer" | "business" | "institutional" | "agent" | "service";
  chainId: number;
  address: Address;
  signer: { qx: Hex; qy: Hex; salt: Hex };
  createdAt: string;
}

export interface AccountRepository {
  create(input: {
    handle: string;
    kind: AccountRecord["kind"];
    chainId: number;
    address: Address;
    signer: AccountRecord["signer"];
  }): Promise<AccountRecord>;
  byHandle(handle: string): Promise<AccountRecord | undefined>;
  byId(accountId: string): Promise<AccountRecord | undefined>;
}

const hexToBuf = (h: string) => Buffer.from(h.slice(2), "hex");
const bufToHex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}` as Address;

export class PgAccountRepository implements AccountRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    handle: string;
    kind: AccountRecord["kind"];
    chainId: number;
    address: Address;
    signer: AccountRecord["signer"];
  }): Promise<AccountRecord> {
    return this.db.begin(async (tx) => {
      // Placeholder owner until the auth service exists: one user row per handle, no PII.
      const emailHash = createHash("sha256").update(`handle:${input.handle}`).digest();
      const [user] = await tx<
        { id: string }[]
      >`insert into "user" (email_hash) values (${emailHash}) on conflict (email_hash) do update set updated_at = now() returning id`;
      const existing = await tx<
        { id: string }[]
      >`select id from account where handle = ${input.handle}`;
      if (existing.length > 0) throw errors.conflict("account handle already exists");
      const [acct] = await tx<
        { id: string; created_at: Date }[]
      >`insert into account (handle, kind, owner_user_id) values (${input.handle}, ${input.kind}, ${user!.id}) returning id, created_at`;
      const [wallet] = await tx<
        { id: string }[]
      >`insert into wallet (account_id, kind, provider, signer) values (${acct!.id}, 'smart_account', 'passkey', ${tx.json(input.signer)}) returning id`;
      await tx`insert into address (wallet_id, chain_id, address) values (${wallet!.id}, ${input.chainId}, ${hexToBuf(input.address)})`;
      return {
        accountId: acct!.id,
        handle: input.handle,
        kind: input.kind,
        chainId: input.chainId,
        address: input.address,
        signer: input.signer,
        createdAt: acct!.created_at.toISOString(),
      };
    });
  }

  private async load(where: ReturnType<Db>): Promise<AccountRecord | undefined> {
    const rows = await this.db<
      {
        id: string;
        handle: string;
        kind: AccountRecord["kind"];
        created_at: Date;
        chain_id: string;
        address: Uint8Array;
        signer: AccountRecord["signer"];
      }[]
    >`
      select a.id, a.handle, a.kind, a.created_at, ad.chain_id, ad.address, w.signer
      from account a join wallet w on w.account_id = a.id join address ad on ad.wallet_id = w.id
      where ${where} order by ad.chain_id limit 1`;
    const r = rows[0];
    return r
      ? {
          accountId: r.id,
          handle: r.handle,
          kind: r.kind,
          chainId: Number(r.chain_id),
          address: bufToHex(r.address),
          signer: r.signer,
          createdAt: r.created_at.toISOString(),
        }
      : undefined;
  }

  byHandle(handle: string) {
    return this.load(this.db`a.handle = ${handle}`);
  }
  byId(accountId: string) {
    return this.load(this.db`a.id = ${accountId}::uuid`);
  }
}

/** In-memory variant for unit tests. */
export class InMemoryAccountRepository implements AccountRepository {
  private readonly rows = new Map<string, AccountRecord>();
  async create(input: {
    handle: string;
    kind: AccountRecord["kind"];
    chainId: number;
    address: Address;
    signer: AccountRecord["signer"];
  }): Promise<AccountRecord> {
    if ([...this.rows.values()].some((r) => r.handle === input.handle))
      throw errors.conflict("account handle already exists");
    const rec: AccountRecord = {
      accountId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.rows.set(rec.accountId, rec);
    return rec;
  }
  async byHandle(handle: string) {
    return [...this.rows.values()].find((r) => r.handle === handle);
  }
  async byId(accountId: string) {
    return this.rows.get(accountId);
  }
}
