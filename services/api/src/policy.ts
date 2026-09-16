import { createHash } from "node:crypto";
import type { Db } from "./db.js";

/**
 * Approval policy (blueprint section 6): thresholds in the intent's source asset base units, each with the
 * number of distinct approvals required. Missing policy = the account owner's signature is enough.
 *   { "thresholds": [ { "aboveBaseUnits": "50000000000", "approvals": 1 }, { "aboveBaseUnits": "1000000000000", "approvals": 2 } ] }
 */
export interface ApprovalPolicy {
  thresholds: Array<{ aboveBaseUnits: string; approvals: number }>;
}

export function requiredApprovals(
  policy: ApprovalPolicy | undefined,
  amountBaseUnits: bigint,
): number {
  if (!policy) return 0;
  let required = 0;
  for (const t of policy.thresholds)
    if (amountBaseUnits > BigInt(t.aboveBaseUnits)) required = Math.max(required, t.approvals);
  return required;
}

export interface PolicyRepository {
  getApprovalPolicy(accountId: string): Promise<ApprovalPolicy | undefined>;
  setApprovalPolicy(accountId: string, policy: ApprovalPolicy): Promise<void>;
  approvals(intentId: string): Promise<string[]>;
  /** Records an approval against the first of `accountIds` that has an active approval policy. */
  addApproval(intentId: string, accountIds: string[], approver: string): Promise<string[]>;
}

export class InMemoryPolicyRepository implements PolicyRepository {
  private readonly policies = new Map<string, ApprovalPolicy>();
  private readonly approvalsByIntent = new Map<string, Set<string>>();
  async getApprovalPolicy(accountId: string) {
    return this.policies.get(accountId);
  }
  async setApprovalPolicy(accountId: string, policy: ApprovalPolicy) {
    this.policies.set(accountId, policy);
  }
  async approvals(intentId: string) {
    return [...(this.approvalsByIntent.get(intentId) ?? [])];
  }
  async addApproval(intentId: string, _accountIds: string[], approver: string) {
    const set = this.approvalsByIntent.get(intentId) ?? new Set<string>();
    set.add(approver);
    this.approvalsByIntent.set(intentId, set);
    return [...set];
  }
}

export class PgPolicyRepository implements PolicyRepository {
  constructor(private readonly db: Db) {}
  async getApprovalPolicy(accountId: string) {
    const rows = await this.db<
      { body: ApprovalPolicy }[]
    >`select body from policy where account_id = ${accountId}::uuid and kind = 'approval' and active order by version desc limit 1`;
    return rows[0]?.body;
  }
  async setApprovalPolicy(accountId: string, policy: ApprovalPolicy) {
    await this.db.begin(async (tx) => {
      const [v] = await tx<
        { next: number }[]
      >`select coalesce(max(version),0)+1 as next from policy where account_id = ${accountId}::uuid and kind = 'approval'`;
      await tx`update policy set active = false where account_id = ${accountId}::uuid and kind = 'approval'`;
      await tx`insert into policy (account_id, kind, version, body, active) values (${accountId}::uuid, 'approval', ${v!.next}, ${tx.json(policy as never)}, true)`;
    });
  }
  async approvals(intentId: string) {
    const rows = await this.db<
      { approver_ids: string[] }[]
    >`select approver_ids from approval where intent_public_id = ${intentId}`;
    return rows[0]?.approver_ids ?? [];
  }
  async addApproval(intentId: string, accountIds: string[], approver: string) {
    return this.db.begin(async (tx) => {
      const [intent] = await tx<
        { id: string }[]
      >`select id from intent where public_id = ${intentId}`;
      if (!intent) throw new Error("intent missing");
      let pol: { id: string } | undefined;
      for (const accountId of accountIds) {
        [pol] = await tx<
          { id: string }[]
        >`select id from policy where account_id = ${accountId}::uuid and kind = 'approval' and active order by version desc limit 1`;
        if (pol) break;
      }
      if (!pol) throw new Error("no approval policy applies to this intent");
      // approver ids are free-form identities until the auth service exists; stored as uuid-shaped text hashes
      const rows = await tx<
        { approver_ids: string[] }[]
      >`select approver_ids from approval where intent_public_id = ${intentId} for update`;
      const ids = new Set(rows[0]?.approver_ids ?? []);
      ids.add(approver);
      if (rows.length === 0) {
        await tx`insert into approval (intent_id, policy_id, required, approver_ids, intent_public_id) values (${intent.id}::uuid, ${pol.id}::uuid, 1, ${tx.array([...ids].map(toUuidLike))}::uuid[], ${intentId})`;
      } else {
        await tx`update approval set approver_ids = ${tx.array([...ids].map(toUuidLike))}::uuid[] where intent_public_id = ${intentId}`;
      }
      return [...ids].map(toUuidLike);
    });
  }
}

/** approval.approver_ids is uuid[] in schema v1; map arbitrary approver identities to a stable uuid-shaped value. */
export function toUuidLike(s: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return s;
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
