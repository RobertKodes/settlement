import type { Db } from "../db.js";
import {
  IDEMPOTENCY_TTL_MS,
  type IdempotencyRecord,
  type IdempotencyStore,
} from "../idempotency.js";

/** Postgres-backed store (table api_idempotency, migration 0002). Async variant of the in-memory interface. */
export class PgIdempotencyStore implements AsyncIdempotencyStore {
  constructor(private readonly db: Db) {}

  async get(scope: string, key: string): Promise<IdempotencyRecord | undefined> {
    const rows = await this.db<
      { fingerprint: string; status: number; body: unknown; created_at: Date }[]
    >`
      select fingerprint, status, body, created_at from api_idempotency where scope = ${scope} and key = ${key}`;
    const row = rows[0];
    if (!row) return undefined;
    if (Date.now() - row.created_at.getTime() > IDEMPOTENCY_TTL_MS) {
      await this.db`delete from api_idempotency where scope = ${scope} and key = ${key}`;
      return undefined;
    }
    return {
      fingerprint: row.fingerprint,
      status: row.status,
      body: row.body,
      storedAt: row.created_at.getTime(),
    };
  }

  async put(scope: string, key: string, rec: IdempotencyRecord): Promise<void> {
    await this.db`insert into api_idempotency (scope, key, fingerprint, status, body)
      values (${scope}, ${key}, ${rec.fingerprint}, ${rec.status}, ${this.db.json(rec.body as never)})
      on conflict (scope, key) do nothing`;
  }
}

export interface AsyncIdempotencyStore {
  get(
    scope: string,
    key: string,
  ): Promise<IdempotencyRecord | undefined> | IdempotencyRecord | undefined;
  put(scope: string, key: string, rec: IdempotencyRecord): Promise<void> | void;
}

/** Adapts the synchronous in-memory store to the async interface. */
export function asAsync(store: IdempotencyStore): AsyncIdempotencyStore {
  return { get: (s, k) => store.get(s, k), put: (s, k, r) => store.put(s, k, r) };
}
