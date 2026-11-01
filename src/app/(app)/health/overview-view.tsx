"use client";

import * as React from "react";
import Link from "next/link";
import { HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RowList, SectionHeader, SectionLink } from "@/components/app/items";
import { HealthRow } from "@/components/health/bits";
import { Metric, MetricStrip } from "@/components/app/metric";
import { LineChart } from "@/components/finance/charts";
import type { HealthDayRow, HealthWorkoutRow } from "@/lib/data/health";
import { dailySeries, deltaPct, durationMin, fmt0, fmt1, fmtHours, recoveryTone, sleepPerformanceTone, strainTone, type HealthSummary } from "@/lib/health/stats";
import { formatDate, formatTimestamp } from "@/lib/dates";

export function OverviewView({ days, workouts, summary, today, isEmpty }: { days: HealthDayRow[]; workouts: HealthWorkoutRow[]; summary: HealthSummary; today: string; isEmpty: boolean }) {
  const [range, setRange] = React.useState<28 | 90>(28);
  if (isEmpty) {
    return (
      <EmptyState
        variant="page"
        icon={<HeartPulse />}
        title="No health data yet"
        description="Import a WHOOP data export or NOOP's CSV export and this page fills in with recovery, HRV, sleep and strain."
        action={
          <Button asChild size="sm">
            <Link href="/health/data">Import an export</Link>
          </Button>
        }
      />
    );
  }

  const latest = summary.latest;
  const hrvDelta = deltaPct(summary.hrv7, summary.hrv30);
  const rhrDelta = deltaPct(summary.rhr7, summary.rhr30);
  const { days: axis, byDay } = dailySeries(days, today, range);
  const labels = axis.map((d) => formatDate(d, "short"));
  const pick = (f: (r: HealthDayRow) => number | null) => axis.map((d) => (byDay.get(d) ? f(byDay.get(d) as HealthDayRow) : null));
  const recent = [...workouts].reverse().slice(0, 6);
  const stale = summary.staleDays != null && summary.staleDays > 1 ? `Last data ${formatDate(latest?.day, "medium", today)}` : latest ? `As of ${formatDate(latest.day, "medium", today)}` : undefined;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="health-now">
        <SectionHeader index="01" title={<span id="health-now">Right now</span>} hint={stale} />
        <MetricStrip cols={2} className="mt-3 md:grid-cols-5">
          <Metric label="Recovery" value={fmt0(latest?.recovery, "%")} tone={recoveryTone(latest?.recovery)} sub={summary.recovery7 != null ? `7-day ${fmt0(summary.recovery7, "%")}` : undefined} muted={latest?.recovery == null} />
          <Metric label="HRV" value={fmt0(latest?.hrv_ms, " ms")} tone={hrvDelta == null ? "neutral" : hrvDelta >= 0 ? "good" : hrvDelta <= -10 ? "warning" : "neutral"} sub={hrvDelta != null ? `${hrvDelta >= 0 ? "+" : ""}${hrvDelta}% vs 30-day` : undefined} muted={latest?.hrv_ms == null} />
          <Metric label="Resting HR" value={fmt0(latest?.resting_hr, " bpm")} tone={rhrDelta == null ? "neutral" : rhrDelta > 5 ? "warning" : "neutral"} sub={rhrDelta != null ? `${rhrDelta >= 0 ? "+" : ""}${rhrDelta}% vs 30-day` : undefined} muted={latest?.resting_hr == null} />
          <Metric label="Sleep" value={fmtHours(latest?.sleep_total_min)} tone={sleepPerformanceTone(latest?.sleep_performance_pct)} sub={latest?.sleep_performance_pct != null ? `${fmt0(latest.sleep_performance_pct, "%")} of need` : undefined} muted={latest?.sleep_total_min == null} />
          <Metric label="Strain" value={fmt1(latest?.strain)} tone={strainTone(latest?.strain)} sub={summary.strainWeek != null ? `Week ${fmt0(summary.strainWeek)}` : undefined} muted={latest?.strain == null} />
        </MetricStrip>
      </section>

      <section aria-labelledby="health-trends">
        <SectionHeader
          index="02"
          title={<span id="health-trends">Trends</span>}
          action={
            <div className="flex gap-1" role="group" aria-label="Range">
              {([28, 90] as const).map((r) => (
                <Button key={r} type="button" size="xs" variant={range === r ? "secondary" : "ghost"} onClick={() => setRange(r)}>
                  {r} days
                </Button>
              ))}
            </div>
          }
        />
        <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Chart title="Recovery" unit="%">
            <LineChart xLabels={labels} series={[{ id: "recovery", name: "Recovery", color: "var(--chart-good)", values: pick((r) => r.recovery) }]} yFormat={(v) => `${Math.round(v)}%`} zeroLine={false} ariaLabel="Recovery score by day" height={200} />
          </Chart>
          <Chart title="HRV" unit="ms">
            <LineChart
              xLabels={labels}
              series={[
                { id: "hrv", name: "HRV", color: "var(--chart-1)", values: pick((r) => r.hrv_ms) },
                { id: "base", name: "30-day average", color: "var(--chart-3)", dashed: true, values: axis.map(() => summary.hrv30) },
              ]}
              yFormat={(v) => `${Math.round(v)} ms`}
              zeroLine={false}
              ariaLabel="Heart rate variability by day with the 30-day average"
              height={200}
            />
          </Chart>
          <Chart title="Sleep" unit="hours">
            <LineChart xLabels={labels} series={[{ id: "sleep", name: "Asleep", color: "var(--chart-2)", values: pick((r) => (r.sleep_total_min == null ? null : r.sleep_total_min / 60)) }]} yFormat={(v) => `${v.toFixed(1)}h`} zeroLine={false} ariaLabel="Hours asleep by day" height={200} />
          </Chart>
          <Chart title="Strain" unit="0 to 21">
            <LineChart xLabels={labels} series={[{ id: "strain", name: "Day strain", color: "var(--chart-4)", values: pick((r) => r.strain) }]} yFormat={(v) => v.toFixed(0)} zeroLine={false} ariaLabel="Day strain by day" height={200} />
          </Chart>
        </div>
      </section>

      <section aria-labelledby="health-workouts">
        <SectionHeader index="03" title={<span id="health-workouts">Recent workouts</span>} count={workouts.length} action={<SectionLink href="/health/workouts">All workouts</SectionLink>} />
        {recent.length ? (
          <RowList className="mt-2">
            {recent.map((w) => (
              <HealthRow key={w.id} title={w.activity} meta={`${formatDate(w.day, "medium", today)} · ${formatTimestamp(w.start_at)} · ${fmtHours(durationMin(w.start_at, w.end_at))}`} value={w.strain != null ? `${fmt1(w.strain)} strain` : w.avg_hr != null ? `${w.avg_hr} bpm` : undefined} />
            ))}
          </RowList>
        ) : (
          <EmptyState className="mt-3" title="No workouts in this window" description="Workouts from the export land here." />
        )}
      </section>
    </div>
  );
}

function Chart({ title, unit, children }: { title: string; unit: string; children: React.ReactNode }) {
  return (
    <div className="border-line-1 bg-surface-1 rounded-lg border p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-heading text-text-1">{title}</h3>
        <span className="text-text-3 text-meta">{unit}</span>
      </div>
      {children}
    </div>
  );
}
