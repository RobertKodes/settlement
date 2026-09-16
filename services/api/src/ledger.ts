import type { Address, Hex } from "viem";
import type { Db } from "./db.js";

/**
 * Ledger posting for a settled on-chain transfer (ADR-0015). One balanced `ledger_transaction` with
 * four entries: sender -amount / recipient +amount, and sender -fee / house fees +fee. Idempotent on
 * the intent id. House accounts have NULL account_id (schema v1, NULLS NOT DISTINCT).
 */
export interface SwapPost {
  intentId: string;
  chainId: number;
  tokenIn: Address;
  symbolIn: string;
  tokenOut: Address;
  symbolOut: string;
  account: string;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint; // in tokenIn units (paymaster charges USDC; tokenIn is USDC or the fee token)
  feeToken: Address;
  feeSymbol: string;
  txHash: Hex;
  blockNumber: bigint;
}

export interface LedgerPoster {
  /** Swap through the native pool: account gives tokenIn (+fee), receives tokenOut; the pool is an external counterparty. */
  postSwap(p: SwapPost): Promise<{ ledgerTransactionId: string; chainTransactionId: string }>;
  postTransfer(p: {
    intentId: string;
    chainId: number;
    token: Address;
    symbol: string;
    decimals: number;
    from: string;
    to: string | undefined;
    amount: bigint;
    fee: bigint;
    txHash: Hex;
    blockNumber: bigint;
  }): Promise<{ ledgerTransactionId: string; chainTransactionId: string }>;
}

const hexToBuf = (h: string) => Buffer.from(h.slice(2), "hex");

export class PgLedgerPoster implements LedgerPoster {
  constructor(private readonly db: Db) {}

  async postSwap(p: SwapPost) {
    return this.db.begin(async (tx) => {
      const assetId = async (symbol: string, token: Address) => {
        const [a] = await tx<
          { id: string }[]
        >`insert into asset (symbol, chain_id, address, decimals, kind) values (${symbol}, ${p.chainId}, ${hexToBuf(token)}, 6, 'stablecoin')
          on conflict (chain_id, symbol, address) do update set decimals = excluded.decimals returning id`;
        return a!.id;
      };
      const la = async (accountId: string | null, asset: string, kind: string): Promise<string> => {
        const rows = await tx<
          { id: string }[]
        >`insert into ledger_account (account_id, asset_id, kind) values (${accountId}::uuid, ${asset}::uuid, ${kind})
          on conflict (account_id, asset_id, kind) do update set kind = excluded.kind returning id`;
        return rows[0]!.id;
      };
      const [inId, outId, feeId] = await Promise.all([
        assetId(p.symbolIn, p.tokenIn),
        assetId(p.symbolOut, p.tokenOut),
        assetId(p.feeSymbol, p.feeToken),
      ]);
      const [chainTx] = await tx<
        { id: string }[]
      >`insert into chain_transaction (chain_id, tx_hash, block_number, status) values (${p.chainId}, ${hexToBuf(p.txHash)}, ${p.blockNumber.toString()}, 'included')
        on conflict (chain_id, tx_hash) do update set block_number = excluded.block_number returning id`;
      const entries = [
        {
          ledger_account_id: await la(p.account, inId, "available"),
          asset_id: inId,
          amount: (-p.amountIn).toString(),
        },
        {
          ledger_account_id: await la(null, inId, "external"),
          asset_id: inId,
          amount: p.amountIn.toString(),
        },
        {
          ledger_account_id: await la(p.account, outId, "available"),
          asset_id: outId,
          amount: p.amountOut.toString(),
        },
        {
          ledger_account_id: await la(null, outId, "external"),
          asset_id: outId,
          amount: (-p.amountOut).toString(),
        },
        {
          ledger_account_id: await la(p.account, feeId, "available"),
          asset_id: feeId,
          amount: (-p.fee).toString(),
        },
        {
          ledger_account_id: await la(null, feeId, "fees"),
          asset_id: feeId,
          amount: p.fee.toString(),
        },
      ].filter((e) => e.amount !== "0");
      const [posted] = await tx<
        { ledger_post: string }[]
      >`select ledger_post(${`intent:${p.intentId}`}, 'swap', 'intent', null, ${tx.json(entries)}, ${`swap ${p.txHash}`})`;
      return { ledgerTransactionId: posted!.ledger_post, chainTransactionId: chainTx!.id };
    });
  }

  async postTransfer(p: Parameters<LedgerPoster["postTransfer"]>[0]) {
    return this.db.begin(async (tx) => {
      const [asset] = await tx<
        { id: string }[]
      >`insert into asset (symbol, chain_id, address, decimals, kind) values (${p.symbol}, ${p.chainId}, ${hexToBuf(p.token)}, ${p.decimals}, 'stablecoin')
        on conflict (chain_id, symbol, address) do update set decimals = excluded.decimals returning id`;
      const la = async (accountId: string | null, kind: string): Promise<string> => {
        const rows = await tx<
          { id: string }[]
        >`insert into ledger_account (account_id, asset_id, kind) values (${accountId}::uuid, ${asset!.id}::uuid, ${kind})
          on conflict (account_id, asset_id, kind) do update set kind = excluded.kind returning id`;
        return rows[0]!.id;
      };
      const [chainTx] = await tx<
        { id: string }[]
      >`insert into chain_transaction (chain_id, tx_hash, block_number, status) values (${p.chainId}, ${hexToBuf(p.txHash)}, ${p.blockNumber.toString()}, 'included')
        on conflict (chain_id, tx_hash) do update set block_number = excluded.block_number returning id`;
      const senderAvail = await la(p.from, "available");
      const recipientAvail = p.to ? await la(p.to, "available") : await la(null, "external");
      const houseFees = await la(null, "fees");
      const entries = [
        {
          ledger_account_id: senderAvail,
          asset_id: asset!.id,
          amount: (-(p.amount + p.fee)).toString(),
        },
        { ledger_account_id: recipientAvail, asset_id: asset!.id, amount: p.amount.toString() },
        { ledger_account_id: houseFees, asset_id: asset!.id, amount: p.fee.toString() },
      ];
      const [posted] = await tx<
        { ledger_post: string }[]
      >`select ledger_post(${`intent:${p.intentId}`}, 'transfer', 'intent', null, ${tx.json(entries)}, ${`transfer ${p.txHash}`})`;
      return { ledgerTransactionId: posted!.ledger_post, chainTransactionId: chainTx!.id };
    });
  }
}

export class NoopLedgerPoster implements LedgerPoster {
  async postSwap(p: SwapPost) {
    this.posts.push(p as never);
    return {
      ledgerTransactionId: `mem-${this.posts.length}`,
      chainTransactionId: `mem-tx-${this.posts.length}`,
    };
  }
  readonly posts: Parameters<LedgerPoster["postTransfer"]>[0][] = [];
  async postTransfer(p: Parameters<LedgerPoster["postTransfer"]>[0]) {
    this.posts.push(p);
    return {
      ledgerTransactionId: `mem-${this.posts.length}`,
      chainTransactionId: `mem-tx-${this.posts.length}`,
    };
  }
}
