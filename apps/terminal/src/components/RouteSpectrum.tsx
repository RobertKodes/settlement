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
