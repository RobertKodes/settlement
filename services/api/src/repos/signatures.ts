import type { Db } from "../db.js";

export interface PartySignature {
  party: "A" | "B";
  signature: `0x${string}`;
  permit?: `0x${string}`;
}

export interface SignatureRepository {
  put(intentId: string, sig: PartySignature): Promise<void>;
  get(intentId: string): Promise<Partial<Record<"A" | "B", PartySignature>>>;
}

export class InMemorySignatureRepository implements SignatureRepository {
  private readonly rows = new Map<string, Partial<Record<"A" | "B", PartySignature>>>();
  async put(intentId: string, sig: PartySignature) {
    this.rows.set(intentId, { ...(this.rows.get(intentId) ?? {}), [sig.party]: sig });
  }
  async get(intentId: string) {
    return this.rows.get(intentId) ?? {};
  }
}

export class PgSignatureRepository implements SignatureRepository {
  constructor(private readonly db: Db) {}
  async put(intentId: string, sig: PartySignature) {
    await this
      .db`insert into settlement_signature (intent_public_id, party, signature, permit) values (${intentId}, ${sig.party}, ${sig.signature}, ${sig.permit ?? null})
      on conflict (intent_public_id, party) do update set signature = excluded.signature, permit = excluded.permit`;
  }
  async get(intentId: string) {
    const rows = await this.db<
      { party: "A" | "B"; signature: `0x${string}`; permit: `0x${string}` | null }[]
    >`select party, signature, permit from settlement_signature where intent_public_id = ${intentId}`;
    const out: Partial<Record<"A" | "B", PartySignature>> = {};
    for (const r of rows)
      out[r.party] = {
        party: r.party,
        signature: r.signature,
        ...(r.permit ? { permit: r.permit } : {}),
      };
    return out;
  }
}
