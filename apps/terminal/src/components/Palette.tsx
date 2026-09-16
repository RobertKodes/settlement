import { useEffect, useState } from "react";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function Palette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const list = items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => setSel(0), []);
  return (
    <div className="palette" onClick={onClose} role="dialog">
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="type a command…"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, list.length - 1));
            if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
            if (e.key === "Enter" && list[sel]) {
              list[sel].run();
              onClose();
            }
          }}
        />
        {list.map((i, k) => (
          <div
            key={i.id}
            className={`opt ${k === sel ? "sel" : ""}`}
            onMouseEnter={() => setSel(k)}
            onClick={() => {
              i.run();
              onClose();
            }}
          >
            <span>{i.label}</span>
            <span>{i.hint}</span>
          </div>
        ))}
        {!list.length && (
          <div className="empty" style={{ padding: 16 }}>
            nothing matches
          </div>
        )}
      </div>
    </div>
  );
}
