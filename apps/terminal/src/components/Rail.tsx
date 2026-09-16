import { STAGES, stageIndex } from "../lib/api.js";

/** The intent lifecycle as a rail: stages as nodes, the live intent as a glowing dot, failures as a red spur. */
export function Rail({ status, failed }: { status?: string; failed?: string }) {
  const idx = status ? stageIndex(status) : -2;
  const n = STAGES.length;
  const x = (i: number) => 24 + (i * (1000 - 48)) / (n - 1);
  return (
    <div className="rail" aria-label="intent lifecycle">
      <svg viewBox="0 0 1000 64" preserveAspectRatio="none">
        <line x1={x(0)} y1="22" x2={x(n - 1)} y2="22" stroke="var(--line-2)" strokeWidth="1" />
        {idx > 0 && (
          <line
            x1={x(0)}
            y1="22"
            x2={x(Math.max(0, idx))}
            y2="22"
            stroke="var(--accent-2)"
            strokeWidth="2"
          />
        )}
        {STAGES.map((s, i) => {
          const done = idx >= 0 && i < idx;
          const on = i === idx;
          return (
            <g key={s}>
              <circle
                cx={x(i)}
                cy="22"
                r={on ? 6 : 3.5}
                fill={done ? "var(--accent-2)" : on ? "var(--accent)" : "var(--bg-3)"}
                stroke={done || on ? "var(--accent)" : "var(--line-2)"}
                strokeWidth="1"
              />
              {on && (
                <circle
                  cx={x(i)}
                  cy="22"
                  r="11"
                  fill="none"
                  stroke="var(--accent)"
                  strokeOpacity="0.35"
                  strokeWidth="1"
                >
                  <animate attributeName="r" values="8;14;8" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              <text
                className={`stage ${done ? "done" : on ? "on" : ""}`}
                x={x(i)}
                y="48"
                textAnchor="middle"
              >
                {s.replace("_", " ")}
              </text>
            </g>
          );
        })}
        {failed && (
          <g>
            <line
              x1={x(Math.max(0, stageIndex(failed.replace(/^FAILED_/, "")) || 2))}
              y1="22"
              x2={x(Math.max(0, stageIndex(failed.replace(/^FAILED_/, "")) || 2)) + 40}
              y2="6"
              stroke="var(--bad)"
              strokeWidth="1.5"
            />
            <text
              x={x(Math.max(0, stageIndex(failed.replace(/^FAILED_/, "")) || 2)) + 46}
              y="8"
              fontSize="10"
              fontFamily="var(--mono)"
              fill="var(--bad)"
            >
              {failed}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
