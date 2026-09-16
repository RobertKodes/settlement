import { hhmmss } from "../lib/format.js";

/** Initiated → executed → L2 settled → L1 proven. The last point pulses until the rollup contract catches up. */
export function ProofTimeline(p: {
  createdAt?: string;
  settledAt?: string;
  l1At?: string;
  l1State?: string;
  l2Block?: number;
  finalized?: string;
}) {
  const proven = p.l1State === "FINALIZED";
  return (
    <div className="timeline">
      <div className="tp done">
        Initiated <div className="when">{hhmmss(p.createdAt)}</div>
      </div>
      <div className={`tp ${p.settledAt ? "done" : ""}`}>
        Executed (user operation mined) <div className="when">{hhmmss(p.settledAt)}</div>
      </div>
      <div className={`tp ${p.settledAt ? "done" : ""}`}>
        L2 settled{p.l2Block !== undefined ? ` · block ${p.l2Block}` : ""}{" "}
        <div className="when">{hhmmss(p.settledAt)}</div>
      </div>
      <div className={`tp ${proven ? "done" : p.settledAt ? "live" : ""}`}>
        L1 proven{p.finalized ? ` · rollup at L2 block ${p.finalized}` : ""}
        <div className="when">
          {proven
            ? hhmmss(p.l1At)
            : p.settledAt
              ? "waiting for the proof to be verified on L1…"
              : "—"}
        </div>
      </div>
    </div>
  );
}
