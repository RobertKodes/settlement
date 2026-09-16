import { useState } from "react";

/**
 * `> settle 5000000 EURC for 1050000 USDC with inst-b` · `> swap 1000 USDC to EURC` · `> send 250 USDC to bob`
 * `> fund 1000 USDC` · `> policy 500 USDC 1` · `> approve risk-officer` · `> reconcile`
 */
export function CommandLine({
  onCommand,
  busy,
}: {
  onCommand: (line: string) => Promise<void>;
  busy: boolean;
}) {
  const [line, setLine] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  return (
    <form
      className="cmd"
      onSubmit={async (e) => {
        e.preventDefault();
        const l = line.trim();
        if (!l) return;
        setHist([l, ...hist].slice(0, 50));
        setHi(-1);
        setLine("");
        await onCommand(l);
      }}
    >
      <span className="prompt">{busy ? "…" : ">"}</span>
      <input
        value={line}
        onChange={(e) => setLine(e.target.value)}
        placeholder="settle 1000 EURC for 1050 USDC with inst-b   ·   swap 1000 USDC to EURC   ·   send 250 USDC to bob   ·   fund 1000 USDC   ·   help"
        spellCheck={false}
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            const n = Math.min(hi + 1, hist.length - 1);
            setHi(n);
            setLine(hist[n] ?? "");
            e.preventDefault();
          }
          if (e.key === "ArrowDown") {
            const n = Math.max(hi - 1, -1);
            setHi(n);
            setLine(n < 0 ? "" : (hist[n] ?? ""));
            e.preventDefault();
          }
        }}
      />
      <span className="hint">
        <kbd>⌘K</kbd> palette
      </span>
    </form>
  );
}
