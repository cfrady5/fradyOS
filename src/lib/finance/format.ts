/** Money and percentage formatting shared by server and client. */

export function fmtMoney(n: number | null | undefined, opts: { compact?: boolean; cents?: boolean; sign?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  let body: string;
  if (opts.compact && abs >= 1_000_000) body = `$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  else if (opts.compact && abs >= 10_000) body = `$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  else body = `$${abs.toLocaleString("en-US", { minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 })}`;
  if (n < 0) return `-${body}`;
  return opts.sign && n > 0 ? `+${body}` : body;
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function fmtMonths(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1) return "less than a month";
  const y = Math.floor(n / 12);
  const m = Math.round(n % 12);
  if (y === 0) return `${m} month${m === 1 ? "" : "s"}`;
  if (m === 0) return `${y} year${y === 1 ? "" : "s"}`;
  return `${y} yr ${m} mo`;
}

export function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
