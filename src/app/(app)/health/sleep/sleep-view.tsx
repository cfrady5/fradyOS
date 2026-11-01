"use client";

import { SectionHeader } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import { FindingList, MetricChart, ScoreChart, ScorePanel } from "@/components/health/intel";
import type { IntelDerived, IntelEvent } from "@/lib/data/intel";
import { fmtMetric, clockFromNoon } from "@/lib/intel/findings";
import type { Baseline, DailySummary, MetricKey } from "@/lib/intel/types";

export function SleepView({ days, baselines, derived, events, today }: { days: DailySummary[]; baselines: Record<MetricKey, Baseline>; derived: IntelDerived[]; events: IntelEvent[]; today: string }) {
  const latest = [...days].reverse().find((d) => d.scored && d.sleep_total_min != null);
  const sqi = [...derived].reverse().find((d) => d.value != null) ?? derived[derived.length - 1] ?? null;
  const restorative = latest && latest.deep_min != null && latest.rem_min != null && latest.sleep_total_min ? Math.round(((latest.deep_min + latest.rem_min) / latest.sleep_total_min) * 100) : null;
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="sleep-now">
        <SectionHeader title={<span id="sleep-now">Last night</span>} hint={latest ? `Night ending ${latest.day}` : undefined} />
        <MetricStrip cols={2} className="mt-3 md:grid-cols-3 lg:grid-cols-6">
          <Metric size="sm" label="Asleep" value={fmtMetric("sleep_total_min", latest?.sleep_total_min)} sub={latest?.sleep_need_min != null ? `need ${fmtMetric("sleep_need_min", latest.sleep_need_min)}` : undefined} muted={latest?.sleep_total_min == null} />
          <Metric size="sm" label="Efficiency" value={fmtMetric("sleep_efficiency", latest?.sleep_efficiency)} muted={latest?.sleep_efficiency == null} />
          <Metric size="sm" label="Restorative" value={restorative != null ? `${restorative}%` : "--"} sub="deep + REM share" muted={restorative == null} />
          <Metric size="sm" label="Awake" value={fmtMetric("awake_min", latest?.awake_min)} sub={latest?.disturbances != null ? `${latest.disturbances} disturbances` : undefined} muted={latest?.awake_min == null} />
          <Metric size="sm" label="Bedtime" value={latest?.sleep_onset_min != null ? clockFromNoon(latest.sleep_onset_min) : "--"} sub={latest?.wake_min != null ? `woke ${clockFromNoon(latest.wake_min)}` : undefined} muted={latest?.sleep_onset_min == null} />
          <Metric size="sm" label="Sleep debt" value={fmtMetric("sleep_debt_min", latest?.sleep_debt_min)} muted={latest?.sleep_debt_min == null} />
        </MetricStrip>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-labelledby="sleep-charts">
          <SectionHeader title={<span id="sleep-charts">Trends</span>} hint="60 days, dashed line is your 90-day median" />
          <MetricChart days={days} metric="sleep_total_min" baseline={baselines.sleep_total_min} />
          <MetricChart days={days} metric="sleep_efficiency" baseline={baselines.sleep_efficiency} height={140} />
          <MetricChart days={days} metric="deep_min" baseline={baselines.deep_min} height={140} />
          <MetricChart days={days} metric="rem_min" baseline={baselines.rem_min} height={140} />
          <ScoreChart rows={derived.slice(-60)} label="Sleep Quality Index" />
        </section>
        <section aria-labelledby="sleep-sqi">
          <SectionHeader title={<span id="sleep-sqi">Sleep Quality Index</span>} />
          <div className="mt-3">
            <ScorePanel score={sqi} label="FRADY Sleep Quality Index" description="Sufficiency 35, efficiency 20, consistency 15, restorative share 20, disturbances 10. Built from the strap's stage estimates, which are not EEG." />
          </div>
        </section>
      </div>

      <section aria-labelledby="sleep-findings">
        <SectionHeader title={<span id="sleep-findings">Findings</span>} count={events.length} />
        <FindingList events={events} today={today} />
      </section>
    </div>
  );
}
