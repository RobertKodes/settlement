import { randomBytes } from "node:crypto";
import { canTransition, type Intent, IntentIdSchema, type IntentStatus } from "@settlement/types";
import type { Db } from "../db.js";
import { errors } from "../errors.js";

/** Intent record as the API exposes it (lifecycle per ADR-0014). `state` carries flow data (quote, execution). */
export interface IntentRecord {
  intentId: string;
  accountId: string;
  status: IntentStatus;
  failureCode?: string;
  intent: Intent;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface IntentRepository {
  create(accountId: string, intent: Intent, idempotencyKey: string): Promise<IntentRecord>;
  get(intentId: string): Promise<IntentRecord | undefined>;
  transition(
    intentId: string,
    to: IntentStatus,
    patch?: { failureCode?: string; state?: Record<string, unknown> },
  ): Promise<IntentRecord>;
}

export function newPublicId(prefix: string): string {
  return `${prefix}_${randomBytes(12)
    .toString("base64url")
    .replace(/[^A-Za-z0-9]/g, "x")}`;
}

function checkTransition(rec: IntentRecord, to: IntentStatus) {
  if (!canTransition(rec.status, to)) throw errors.illegalTransition(rec.status, to);
}

export class InMemoryIntentRepository implements IntentRepository {
  private readonly rows = new Map<string, IntentRecord>();
  async create(accountId: string, intent: Intent): Promise<IntentRecord> {
    const now = new Date().toISOString();
    const intentId = IntentIdSchema.parse(newPublicId("int"));
    const rec: IntentRecord = {
      intentId,
      accountId,
      status: "CREATED",
      intent: { ...intent, intentId },
      state: {},
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(intentId, rec);
    return rec;
  }
  async get(intentId: string) {
    return this.rows.get(intentId);
  }
  async transition(
    intentId: string,
    to: IntentStatus,
    patch: { failureCode?: string; state?: Record<string, unknown> } = {},
  ) {
    const rec = this.rows.get(intentId);
    if (!rec) throw errors.notFound("intent");
    checkTransition(rec, to);
    rec.status = to;
    if (patch.failureCode !== undefined) rec.failureCode = patch.failureCode;
    if (patch.state) rec.state = { ...rec.state, ...patch.state };
    rec.updatedAt = new Date().toISOString();
    return rec;
  }
}

interface Row {
  id: string;
  public_id: string;
  account_id: string;
  status: IntentStatus;
  failure_code: string | null;
  body: Intent & { state?: Record<string, unknown> };
  created_at: Date;
  updated_at: Date;
}

/** Postgres-backed repository over schema v1's `intent` table; flow state lives in body.state. */
export class PgIntentRepository implements IntentRepository {
  constructor(private readonly db: Db) {}

  private toRecord(r: Row): IntentRecord {
    const { state, ...intent } = r.body;
    return {
      intentId: r.public_id,
      accountId: r.account_id,
      status: r.status,
      ...(r.failure_code ? { failureCode: r.failure_code } : {}),
      intent,
      state: state ?? {},
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }

  async create(accountId: string, intent: Intent, idempotencyKey: string): Promise<IntentRecord> {
    const publicId = IntentIdSchema.parse(newPublicId("int"));
    const body = { ...intent, intentId: publicId, state: {} };
    const rows = await this.db<
      Row[]
    >`insert into intent (public_id, account_id, idempotency_key, action, body, deadline)
      values (${publicId}, ${accountId}::uuid, ${`${accountId}:${idempotencyKey}`}, ${intent.action}, ${this.db.json(body as never)}, ${intent.constraints.deadline ?? null})
      returning id, public_id, account_id, status, failure_code, body, created_at, updated_at`;
    return this.toRecord(rows[0]!);
  }

  async get(intentId: string) {
    const rows = await this.db<
      Row[]
    >`select id, public_id, account_id, status, failure_code, body, created_at, updated_at from intent where public_id = ${intentId}`;
    return rows[0] ? this.toRecord(rows[0]) : undefined;
  }

  async transition(
    intentId: string,
    to: IntentStatus,
    patch: { failureCode?: string; state?: Record<string, unknown> } = {},
  ) {
    return this.db.begin(async (tx) => {
      const rows = await tx<
        Row[]
      >`select id, public_id, account_id, status, failure_code, body, created_at, updated_at from intent where public_id = ${intentId} for update`;
      const cur = rows[0];
      if (!cur) throw errors.notFound("intent");
      checkTransition(this.toRecord(cur), to);
      const body = { ...cur.body, state: { ...(cur.body.state ?? {}), ...(patch.state ?? {}) } };
      const updated = await tx<
        Row[]
      >`update intent set status = ${to}, failure_code = ${patch.failureCode ?? cur.failure_code}, body = ${tx.json(body as never)}
        where id = ${cur.id} returning id, public_id, account_id, status, failure_code, body, created_at, updated_at`;
      return this.toRecord(updated[0]!);
    });
  }
}
