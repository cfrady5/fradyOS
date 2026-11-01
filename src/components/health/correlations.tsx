"use client";

import { EmptyState } from "@/components/ui/empty-state";
import type { IntelCorrelation } from "@/lib/data/intel";

/** Correlations with their sample size, interval and period, worded as associations. */
export function CorrelationTable({ rows }: { rows: IntelCorrelation[] }) {
  if (!rows.length) return <EmptyState className="mt-3" title="No relationships yet" description="Relationships appear once at least two weeks of paired days exist and the association is not negligible." />;
  return (
    <div className="hairline-rows -mx-2 mt-3">
      {rows.map((c) => (
        <div key={c.key} className="px-2 py-3">
          <p className="text-text-1 text-sm font-medium">
            {c.x_label} and {c.y_label}
            {c.lag_days ? ` (${c.lag_days}-day lag)` : ""}
          </p>
          <p className="text-text-3 text-meta nums mt-1">
            {c.r != null ? `r = ${c.r.toFixed(2)}${c.ci_low != null && c.ci_high != null ? ` (95% CI ${c.ci_low.toFixed(2)} to ${c.ci_high.toFixed(2)})` : ""}` : c.diff != null ? `difference ${c.diff.toFixed(1)}${c.diff_ci_low != null && c.diff_ci_high != null ? ` (95% CI ${c.diff_ci_low.toFixed(1)} to ${c.diff_ci_high.toFixed(1)})` : ""}` : ""}
            {` · n = ${c.sample_n} · ${c.method}`}
            {c.period_start && c.period_end ? ` · ${c.period_start} to ${c.period_end}` : ""}
          </p>
          <p className="text-text-3 mt-1 text-xs">An association in your own data, not a cause.</p>
        </div>
      ))}
    </div>
  );
}
