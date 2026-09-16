import { useState } from "react";
import type { Portfolio, PortfolioLine } from "../lib/api.js";
import { money, short, units } from "../lib/format.js";

const GROUPS: Array<[PortfolioLine["group"], string]> = [
  ["fiat", "Fiat"],
  ["stablecoins", "Stablecoins"],
  ["digital-assets", "Digital assets"],
  ["positions", "Positions"],
  ["pending", "Pending settlement"],
];

/** Unified account: one net figure, every line expandable into where it came from. */
export function AccountView({
  p,
  onFund,
}: {
  p?: Portfolio;
  onFund: (asset: "USDC" | "EURC") => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!p) return <div className="empty">select or create an account</div>;
  return (
    <div>
      <div className="net">
        {money(p.totals.net)}
        <br />
        <small>
          net assets · {p.account.handle} · <span className="mono">{short(p.account.address)}</span>
        </small>
      </div>
      <div style={{ marginTop: 8 }}>
        <span
          className={`chip ${p.reconciliation.status === "clean" ? "ok" : p.reconciliation.status === "breaks" ? "bad" : ""}`}
        >
          reconciliation {p.reconciliation.status}
        </span>{" "}
        <span className="chip">chain {p.account.chainId}</span>
      </div>
      {GROUPS.map(([g, label]) => {
        const lines = p.lines.filter((l) => l.group === g);
        if (!lines.length && g !== "stablecoins") return null;
        return (
          <div className="group" key={g}>
            <div className="label">
              <span>{label}</span>
              <span>{p.totals.byGroup[g] ? money(p.totals.byGroup[g]!) : ""}</span>
            </div>
            {lines.map((l, i) => {
              const key = `${g}:${l.asset}:${i}`;
              const agrees = l.provenance.agrees;
              return (
                <div key={key}>
                  <div className="line" onClick={() => setOpen(open === key ? null : key)}>
                    <span>
                      {l.asset}{" "}
                      {agrees === false && <span className="chip bad">ledger differs</span>}
                      {agrees === true && <span className="chip ok">ledger =</span>}
                    </span>
                    <span className="amt">
                      {units(l.amount, l.decimals, l.decimals > 6 ? 4 : 2)}
                    </span>
                  </div>
                  {open === key && (
                    <div className="prov">
                      <div>
                        <span className="k">source</span>
                        {l.provenance.source}
                        {l.provenance.chainId ? ` · chain ${l.provenance.chainId}` : ""}
                      </div>
                      {l.provenance.contract && (
                        <div>
                          <span className="k">contract</span>
                          {short(l.provenance.contract, 8)}
                        </div>
                      )}
                      {l.provenance.address && (
                        <div>
                          <span className="k">address</span>
                          {short(l.provenance.address, 8)}
                        </div>
                      )}
                      {l.provenance.ledger !== undefined && (
                        <div>
                          <span className="k">ledger</span>
                          {units(l.provenance.ledger, l.decimals, 2)}{" "}
                          {agrees ? "(agrees)" : "(BREAK)"}
                        </div>
                      )}
                      {l.provenance.detail && (
                        <div>
                          <span className="k">note</span>
                          {l.provenance.detail}
                        </div>
                      )}
                      <div>
                        <span className="k">as of</span>
                        {new Date(l.provenance.asOf).toLocaleTimeString("en-GB")}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {g === "stablecoins" && (
              <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                <button onClick={() => onFund("USDC")}>+ faucet USDC</button>
                <button onClick={() => onFund("EURC")}>+ faucet EURC</button>
              </div>
            )}
          </div>
        );
      })}
      <div className="hair" />
      <div className="dimmer mono" style={{ fontSize: 11 }}>
        rates:{" "}
        {Object.entries(p.totals.rates)
          .map(([k, v]) => `${k} ${v}`)
          .join(" · ")}{" "}
        (devnet stub)
      </div>
    </div>
  );
}
