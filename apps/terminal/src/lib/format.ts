export function units(base: string | bigint, decimals: number, maxFrac = decimals): string {
  const n = BigInt(base);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 10n ** BigInt(decimals);
  const frac = (abs % 10n ** BigInt(decimals))
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFrac)
    .replace(/0+$/, "");
  const w = whole.toLocaleString("en-US");
  return `${neg ? "-" : ""}${w}${frac ? `.${frac}` : ""}`;
}

export function toBase(display: string, decimals: number): string {
  const clean = display.replace(/[^\d.]/g, "");
  const [w = "0", f = ""] = clean.split(".");
  return (
    BigInt(w || "0") * 10n ** BigInt(decimals) +
    BigInt((f + "0".repeat(decimals)).slice(0, decimals))
  ).toString();
}

export function money(usd: string | number): string {
  return `$${Number(usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function hhmmss(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function short(hex?: string, n = 6): string {
  return hex ? `${hex.slice(0, 2 + n)}…${hex.slice(-4)}` : "—";
}
