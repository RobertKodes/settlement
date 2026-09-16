import { randomBytes } from "node:crypto";
import {
  canTransition,
  type Intent,
  type IntentId,
  IntentIdSchema,
  type IntentStatus,
} from "@settlement/types";
import { errors } from "./errors.js";

/** Intent record as the API exposes it. Lifecycle per ADR-0014. */
export interface IntentRecord {
  intentId: IntentId;
  accountId: string;
  status: IntentStatus;
  failureCode?: string;
  intent: Intent;
  createdAt: string;
  updatedAt: string;
}

export interface IntentRepository {
  create(accountId: string, intent: Intent): IntentRecord;
  get(intentId: string): IntentRecord | undefined;
  transition(intentId: string, to: IntentStatus, failureCode?: string): IntentRecord;
}

export function newIntentId(): IntentId {
  return IntentIdSchema.parse(
    `int_${randomBytes(12)
      .toString("base64url")
      .replace(/[^A-Za-z0-9]/g, "x")}`,
  );
}

export class InMemoryIntentRepository implements IntentRepository {
  private readonly rows = new Map<string, IntentRecord>();

  create(accountId: string, intent: Intent): IntentRecord {
    const now = new Date().toISOString();
    const intentId = newIntentId();
    const rec: IntentRecord = {
      intentId,
      accountId,
      status: "CREATED",
      intent: { ...intent, intentId },
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(intentId, rec);
    return rec;
  }

  get(intentId: string): IntentRecord | undefined {
    return this.rows.get(intentId);
  }

  transition(intentId: string, to: IntentStatus, failureCode?: string): IntentRecord {
    const rec = this.rows.get(intentId);
    if (!rec) throw errors.notFound("intent");
    if (!canTransition(rec.status, to)) {
      throw Object.assign(new Error(`illegal transition ${rec.status} -> ${to}`), {
        code: "illegal_transition",
      });
    }
    rec.status = to;
    if (failureCode !== undefined) rec.failureCode = failureCode;
    rec.updatedAt = new Date().toISOString();
    return rec;
  }
}
