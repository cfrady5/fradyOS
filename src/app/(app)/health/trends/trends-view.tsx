"use client";

import { SectionHeader } from "@/components/app/items";
import { EmptyState } from "@/components/ui/empty-state";
import { LineChart } from "@/components/finance/charts";
import { FindingList, ScorePanel } from "@/components/health/intel";
import type { IntelDerived, IntelEvent } from "@/lib/data/intel";
import { fmtMetric } from "@/lib/intel/findings";
import { METRICS, type MetricKey } from "@/lib/intel/types";

type Series = { metric: MetricKey; monthly: { month: string; mean: number | null; n: number }[]; slope90: number | null }[];

export function TrendsView({ series, trend, events, today }: { series: Series; trend: IntelDerived | null; events: IntelEvent[]; today: string }) {
  const shown = series.filter((s) => s.monthly.some((m) => m.mean != null));
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-labelledby="tr-monthly">
          <SectionHeader title={<span id="tr-monthly">Monthly means</span>} hint="Each point is one calendar month of scored days" />
          {shown.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {shown.map((s) => (
                <div key={s.metric}>
                  <p className="text-text-2 mt-3 text-sm">
                    {METRICS[s.metric].label}
                    {s.slope90 != null ? <span className="text-text-3 text-meta nums"> · 90-day slope {s.slope90 >= 0 ? "+" : ""}{fmtMetric(s.metric, s.slope90 * 30)} per month</span> : null}
                  </p>
                  <LineChart className="mt-1" xLabels={s.monthly.map((m) => m.month.slice(2))} series={[{ id: s.metric, name: METRICS[s.metric].label, color: "var(--chart-1)", values: s.monthly.map((m) => m.mean) }]} height={130} zeroLine={false} yFormat={(v) => fmtMetric(s.metric, v)} ariaLabel={`${METRICS[s.metric].label} by month`} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState className="mt-3" title="Not enough history" description="Long-term trends need at least two months of data." />
          )}
        </section>
        <section aria-labelledby="tr-score">
          <SectionHeader title={<span id="tr-score">Health Trend</span>} />
          <div className="mt-3">
            <ScorePanel score={trend} label="FRADY Health Trend (experimental)" description="A 90-day direction summary of resting heart rate, HRV, sleep consistency, sleep efficiency, recovery consistency and activity consistency. 50 means no change. It is not a biological age and has not been validated against outcomes." />
          </div>
        </section>
      </div>
      <section aria-labelledby="tr-findings">
        <SectionHeader title={<span id="tr-findings">Findings</span>} count={events.length} />
        <FindingList events={events} today={today} />
      </section>
    </div>
  );
}
