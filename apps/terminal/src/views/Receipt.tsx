import { ProofTimeline } from "../components/ProofTimeline.js";
import type { IntentView, Receipt } from "../lib/api.js";
import { short, units } from "../lib/format.js";

export function ReceiptView({ intent, receipt }: { intent?: IntentView; receipt?: Receipt }) {
  if (!intent) return <div className="empty">select an intent from the feed</div>;
  const st = intent.state as {
    txHash?: string;
    blockNumber?: string;
    feeBaseUnits?: string;
    receivedBaseUnits?: string;
    settledAt?: string;
    l1FinalAt?: string;
    userOpHash?: string;
    ledger?: { ledgerTransactionId: string };
    route?: Array<{ venue: string }>;
    error?: string;
    required?: number;
    approvals?: string[];
  };
  const src = intent.intent.source;
  const dst = intent.intent.destination;
  return (
    <div className="receipt">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="accent" style={{ fontWeight: 600 }}>
          SETTLEMENT {receipt?.settlementId ?? intent.intentId}
        </span>
        <span className={`status ${intent.status}`}>{receipt?.status ?? intent.status}</span>
      </div>
      <div className="hair" />
      <div className="kv">
        <b>action</b>
        <span>{intent.intent.action}</span>
      </div>
      <div className="kv">
        <b>{intent.intent.action === "settle" ? "deliver" : "in"}</b>
        <span>
          {units(src.amount, 6)} {src.asset}
        </span>
      </div>
      <div className="kv">
        <b>{intent.intent.action === "settle" ? "receive" : "out"}</b>
        <span>
          {dst.amount
            ? `${units(dst.amount, 6)} ${dst.asset}`
            : st.receivedBaseUnits
              ? `${units(st.receivedBaseUnits, 6)} ${dst.asset}`
              : `${dst.asset} → ${dst.recipient}`}
        </span>
      </div>
      {st.feeBaseUnits && (
        <div className="kv">
          <b>fee</b>
          <span>
            {units(st.feeBaseUnits, 6)} USDC{" "}
            {intent.intent.action === "settle" ? "(agent-paid)" : "(paid in USDC, no ETH)"}
          </span>
        </div>
      )}
      <div className="kv">
        <b>execution</b>
        <span>{(st.route ?? receipt?.route)?.map((r) => r.venue).join(", ") ?? "—"}</span>
      </div>
      <div className="kv">
        <b>settlement</b>
        <span>Lineth L2 (chain 1337)</span>
      </div>
      <div className="kv">
        <b>proof</b>
        <span>Ethereum (local L1) · {receipt?.l1Finality.state ?? "PENDING"}</span>
      </div>
      {st.txHash && (
        <div className="kv">
          <b>tx</b>
          <span className="hash">{st.txHash}</span>
        </div>
      )}
      {st.userOpHash && (
        <div className="kv">
          <b>user op</b>
          <span className="hash">{short(st.userOpHash, 10)}</span>
        </div>
      )}
      {st.ledger && (
        <div className="kv">
          <b>ledger</b>
          <span>
            {short(st.ledger.ledgerTransactionId, 8)} · {receipt?.reconciliation.status ?? "—"}
          </span>
        </div>
      )}
      {intent.failureCode && (
        <div className="kv">
          <b>failure</b>
          <span className="bad">
            {intent.failureCode}
            {st.error ? ` — ${st.error.slice(0, 140)}` : ""}
          </span>
        </div>
      )}
      <ProofTimeline
        createdAt={intent.createdAt}
        settledAt={st.settledAt}
        l1At={st.l1FinalAt}
        l1State={receipt?.l1Finality.state}
        l2Block={st.blockNumber ? Number(st.blockNumber) : undefined}
        finalized={receipt?.finalizedL2Block}
      />
    </div>
  );
}
