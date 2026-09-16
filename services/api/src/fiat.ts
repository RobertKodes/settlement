import { testUSDCAbi } from "@settlement/contracts-abi";
import type { FiatProvider, Iso4217, Transfer } from "@settlement/integration-fiat";
import type { Address, Hex } from "viem";
import type { Db } from "./db.js";
import type { ChainDeps } from "./execution.js";
import type { AccountRecord } from "./repos/accounts.js";

/**
 * Milestone G (blueprint section 11): fiat is a regulated edge behind the FiatProvider interface.
 * On-ramp: provider transfer -> (webhook: payment_processed) -> USDC credited on chain from the treasury
 * -> ledger fiat_in. Off-ramp: account's USDC moved to the treasury (a transfer intent) -> provider payout.
 * On the devnet the treasury mints TestUSDC; with Bridge it is the provider that settles USDC to the address.
 */
export interface FiatTransferRecord {
  id: string;
  accountId: string;
  direction: "on_ramp" | "off_ramp";
  provider: string;
  providerTransferId: string;
  currency: Iso4217;
  fiatAmount: string;
  assetAmountBaseUnits: string;
  state: Transfer["state"];
  txHash?: Hex;
  createdAt: string;
  updatedAt: string;
}

export interface FiatRepository {
  create(
    rec: Omit<FiatTransferRecord, "id" | "createdAt" | "updatedAt">,
    idempotencyKey: string,
  ): Promise<FiatTransferRecord>;
  byProviderId(
    provider: string,
    providerTransferId: string,
  ): Promise<FiatTransferRecord | undefined>;
  update(
    id: string,
    patch: Partial<Pick<FiatTransferRecord, "state" | "txHash">> & { lastEventId?: string },
  ): Promise<FiatTransferRecord>;
  seenEvent(id: string, eventId: string): Promise<boolean>;
}

export class InMemoryFiatRepository implements FiatRepository {
  private readonly rows = new Map<string, FiatTransferRecord>();
  private readonly events = new Map<string, Set<string>>();
  async create(rec: Omit<FiatTransferRecord, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const full = { ...rec, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    this.rows.set(full.id, full);
    return full;
  }
  async byProviderId(provider: string, providerTransferId: string) {
    return [...this.rows.values()].find(
      (r) => r.provider === provider && r.providerTransferId === providerTransferId,
    );
  }
  async update(
    id: string,
    patch: Partial<Pick<FiatTransferRecord, "state" | "txHash">> & { lastEventId?: string },
  ) {
    const r = this.rows.get(id);
    if (!r) throw new Error("fiat transfer missing");
    Object.assign(r, {
      ...(patch.state ? { state: patch.state } : {}),
      ...(patch.txHash ? { txHash: patch.txHash } : {}),
      updatedAt: new Date().toISOString(),
    });
    return r;
  }
  async seenEvent(id: string, eventId: string) {
    const set = this.events.get(id) ?? new Set<string>();
    const seen = set.has(eventId);
    set.add(eventId);
    this.events.set(id, set);
    return seen;
  }
}

const hexToBuf = (h: string) => Buffer.from(h.slice(2), "hex");

export class PgFiatRepository implements FiatRepository {
  constructor(
    private readonly db: Db,
    private readonly usdcAssetId: () => Promise<string>,
  ) {}

  private toRec(r: Record<string, unknown>): FiatTransferRecord {
    return {
      id: r.id as string,
      accountId: r.account_id as string,
      direction: r.direction as "on_ramp" | "off_ramp",
      provider: r.provider as string,
      providerTransferId: r.provider_transfer_id as string,
      currency: r.fiat_currency as Iso4217,
      fiatAmount: String(r.fiat_amount),
      assetAmountBaseUnits: String(r.asset_amount ?? "0"),
      state: r.state as Transfer["state"],
      ...(r.tx_hash
        ? { txHash: `0x${Buffer.from(r.tx_hash as Uint8Array).toString("hex")}` as Hex }
        : {}),
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }

  async create(
    rec: Omit<FiatTransferRecord, "id" | "createdAt" | "updatedAt">,
    idempotencyKey: string,
  ) {
    const asset = await this.usdcAssetId();
    const rows = await this.db<Record<string, unknown>[]>`
      with pc as (
        insert into provider_customer (account_id, provider, provider_customer_id, onboarding_state)
        values (${rec.accountId}::uuid, ${rec.provider}, ${`cus_${rec.accountId}`}, 'approved')
        on conflict (account_id, provider) do update set updated_at = now() returning id
      )
      insert into fiat_transfer (account_id, provider_customer_id, direction, provider_transfer_id, idempotency_key, fiat_currency, fiat_amount, asset_id, asset_amount, state)
      select ${rec.accountId}::uuid, pc.id, ${rec.direction}, ${rec.providerTransferId}, ${idempotencyKey}, ${rec.currency}, ${rec.fiatAmount}::numeric, ${asset}::uuid, ${rec.assetAmountBaseUnits}::numeric, ${rec.state} from pc
      returning *, ${rec.provider} as provider`;
    return this.toRec(rows[0]!);
  }
  async byProviderId(provider: string, providerTransferId: string) {
    const rows = await this.db<
      Record<string, unknown>[]
    >`select f.*, pc.provider from fiat_transfer f join provider_customer pc on pc.id = f.provider_customer_id where pc.provider = ${provider} and f.provider_transfer_id = ${providerTransferId}`;
    return rows[0] ? this.toRec(rows[0]) : undefined;
  }
  async update(
    id: string,
    patch: Partial<Pick<FiatTransferRecord, "state" | "txHash">> & { lastEventId?: string },
  ) {
    const rows = await this.db<Record<string, unknown>[]>`update fiat_transfer f set
        state = coalesce(${patch.state ?? null}, state),
        last_event_id = coalesce(${patch.lastEventId ?? null}, last_event_id)
      where id = ${id}::uuid returning *, (select provider from provider_customer where id = f.provider_customer_id) as provider`;
    if (patch.txHash)
      await this
        .db`update chain_transaction set status = 'included' where tx_hash = ${hexToBuf(patch.txHash)}`;
    return this.toRec(rows[0]!);
  }
  async seenEvent(id: string, eventId: string) {
    const rows = await this.db<
      { last_event_id: string | null }[]
    >`select last_event_id from fiat_transfer where id = ${id}::uuid`;
    return rows[0]?.last_event_id === eventId;
  }
}

export interface FiatDeps {
  provider: FiatProvider;
  repo: FiatRepository;
  chain?: ChainDeps;
  /** Devnet: mint test USDC from the treasury key. Production: the provider settles USDC on chain itself. */
  creditOnChain?: (to: Address, baseUnits: bigint) => Promise<Hex>;
}

/** Devnet treasury credit: the bundler key owns TestUSDC and mints. */
export function devnetCredit(chain: ChainDeps) {
  return async (to: Address, baseUnits: bigint): Promise<Hex> => {
    const hash = await chain.bundler.writeContract({
      address: chain.usdc,
      abi: testUSDCAbi,
      functionName: "mint",
      args: [to, baseUnits],
    });
    await chain.l2.waitForTransactionReceipt({ hash });
    return hash;
  };
}

/** Fiat display amount ("1000.50") -> USDC base units at 1:1 for USD (FX for other currencies comes from the provider quote). */
export function fiatToBaseUnits(amount: string, quoteOut?: string): bigint {
  const src = quoteOut ?? amount;
  const [whole, frac = ""] = src.split(".");
  return BigInt(whole ?? "0") * 1_000_000n + BigInt(`${frac}000000`.slice(0, 6));
}

export type { AccountRecord };
