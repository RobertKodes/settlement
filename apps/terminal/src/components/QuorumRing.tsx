/** Signatures and approvals as arcs on one ring: filled = collected. */
export function QuorumRing({ have, need, label }: { have: number; need: number; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const segs = Math.max(need, 1);
  const gap = 6;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-label={`${label} ${have}/${need}`}>
      {Array.from({ length: segs }, (_, i) => {
        const len = c / segs - gap;
        const off = -(i * (c / segs));
        const done = i < have;
        return (
          <circle
            key={`arc-${off}-${done ? "on" : "off"}`}
            cx="48"
            cy="48"
            r={r}
            fill="none"
            stroke={done ? "var(--accent)" : "var(--line-2)"}
            strokeWidth={done ? 4 : 2}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={off}
            transform="rotate(-90 48 48)"
            strokeLinecap="butt"
          />
        );
      })}
      <text
        x="48"
        y="45"
        textAnchor="middle"
        fontFamily="var(--mono)"
        fontSize="16"
        fill="var(--ink)"
      >
        {have}/{need}
      </text>
      <text
        x="48"
        y="60"
        textAnchor="middle"
        fontFamily="var(--mono)"
        fontSize="9"
        fill="var(--ink-3)"
        letterSpacing="1"
      >
        {label}
      </text>
    </svg>
  );
}
