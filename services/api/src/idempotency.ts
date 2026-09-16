import { createHash } from "node:crypto";

/**
 * Idempotency semantics (ADR-0024): same key + same payload -> the original response; same key +
 * different payload -> 409. Keys are scoped per account and retained 24 h. In-memory here; the
 * Postgres-backed store lands with the ledger service and keeps this interface.
 */
export interface IdempotencyRecord {
  fingerprint: string;
  status: number;
  body: unknown;
  storedAt: number;
}

export interface IdempotencyStore {
  get(scope: string, key: string): IdempotencyRecord | undefined;
  put(scope: string, key: string, rec: IdempotencyRecord): void;
}

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function fingerprint(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload ?? null))
    .digest("hex");
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, IdempotencyRecord>();
  constructor(private readonly now: () => number = Date.now) {}
  get(scope: string, key: string): IdempotencyRecord | undefined {
    const rec = this.map.get(`${scope}:${key}`);
    if (!rec) return undefined;
    if (this.now() - rec.storedAt > IDEMPOTENCY_TTL_MS) {
      this.map.delete(`${scope}:${key}`);
      return undefined;
    }
    return rec;
  }
  put(scope: string, key: string, rec: IdempotencyRecord): void {
    this.map.set(`${scope}:${key}`, rec);
  }
}
