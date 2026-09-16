import { units } from "../lib/format.js";

export interface RankedVenue {
  venue: string;
  amountOut: string;
  score: number;
  executable: boolean;
  reason?: string;
}

/** Every venue the router looked at, as a bar of net output relative to the best. Hatched = not executable from here. */
export function RouteSpectrum({
  ranked,
  chosen,
  asset,
}: {
  ranked: RankedVenue[];
  chosen?: string;
  asset: string;
}) {
  const max = ranked.reduce((m, r) => (BigInt(r.amountOut) > m ? BigInt(r.amountOut) : m), 0n);
  if (!ranked.length) return <div className="empty">no venues quoted</div>;
  return (
    <div className="spectrum">
      {ranked.map((r) => {
        const pct = max > 0n ? Number((BigInt(r.amountOut) * 10_000n) / max) / 100 : 0;
        const best = r.venue === chosen;
        return (
          <div
            key={r.venue}
            className={`row ${best ? "best" : ""} ${r.executable ? "" : "dead"}`}
            title={r.reason ?? ""}
          >
            <span className={best ? "accent" : "dim"}>{r.venue}</span>
            <div className="bar">
              <i style={{ width: `${pct}%` }} />
            </div>
            <span className="out">
              {units(r.amountOut, 6, 2)} {asset}
            </span>
            <span className={best ? "accent" : "dimmer"}>
              {best ? "BEST" : r.executable ? `${pct.toFixed(2)}%` : "n/a"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Plans as legs across systems: Lineth · CCTP · Arc. BLOCKED legs are hatched and say why. */
export function PlanLegs({
  plans,
}: {
  plans: Array<{
    id: string;
    executable: boolean;
    blocked: string[];
    amountOut: string;
    legs: Array<{
      id: string;
      system: string;
      venue?: string;
      kind: string;
      assetIn: string;
      assetOut: string;
      amountOut: string;
      executable: boolean;
      blockedReason?: string;
      latencySeconds: number;
    }>;
  }>;
}) {
  if (!plans.length) return <div className="empty">no plans</div>;
  return (
    <div className="plans">
      {plans.map((p) => (
        <div key={p.id} className={`plan ${p.executable ? "live" : "dead"}`}>
          <div className="plan-head">
            <span className={p.executable ? "accent" : "dimmer"}>{p.id}</span>
            <span className="dim">{p.executable ? "executable" : "BLOCKED"}</span>
          </div>
          <div className="legs">
            {p.legs.map((l) => (
              <div
                key={l.id}
                className={`leg ${l.executable ? "" : "dead"}`}
                title={l.blockedReason ?? ""}
              >
                <span className="sys">{l.system.toUpperCase()}</span>
                <span>{l.venue ?? l.kind}</span>
                <span className="dim">
                  {l.assetIn} → {l.assetOut}
                </span>
                <span className="dim">{l.latencySeconds}s</span>
                {!l.executable && <span className="bad">{l.blockedReason}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
