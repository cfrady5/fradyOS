"use client";

import { SectionHeader } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import { FindingList, MetricChart } from "@/components/health/intel";
import { CorrelationTable } from "@/components/health/correlations";
import type { IntelCorrelation, IntelEvent } from "@/lib/data/intel";
import { fmtMetric } from "@/lib/intel/findings";
import type { Baseline, DailySummary, MetricKey } from "@/lib/intel/types";

function pctile(b: Baseline | undefined) {
  return b?.percentile != null ? `p${Math.round(b.percentile)} of 90 days` : undefined;
}

export function HeartView({ days, baselines, events, correlations, today }: { days: DailySummary[]; baselines: Record<MetricKey, Baseline>; events: IntelEvent[]; correlations: IntelCorrelation[]; today: string }) {
  const latest = [...days].reverse().find((d) => d.scored && (d.resting_hr != null || d.hrv_rmssd != null));
  const rhr = baselines.resting_hr;
  const hrv = baselines.hrv_rmssd;
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="heart-now">
        <SectionHeader title={<span id="heart-now">This morning</span>} hint={latest ? `As of ${latest.day}` : undefined} />
        <MetricStrip cols={2} className="mt-3 md:grid-cols-4">
          <Metric size="sm" label="Resting HR" value={fmtMetric("resting_hr", latest?.resting_hr)} sub={pctile(rhr)} tone={rhr?.percentile != null && rhr.percentile > 85 ? "warning" : "neutral"} muted={latest?.resting_hr == null} />
          <Metric size="sm" label="HRV" value={fmtMetric("hrv_rmssd", latest?.hrv_rmssd)} sub={pctile(hrv)} tone={hrv?.percentile != null && hrv.percentile < 15 ? "warning" : "neutral"} muted={latest?.hrv_rmssd == null} />
          <Metric size="sm" label="RHR baseline" value={fmtMetric("resting_hr", rhr?.median90)} sub={rhr ? `${rhr.n} samples · 30-day ${fmtMetric("resting_hr", rhr.mean30)}` : undefined} muted={!rhr?.ready} />
          <Metric size="sm" label="HRV baseline" value={fmtMetric("hrv_rmssd", hrv?.median90)} sub={hrv ? `${hrv.n} samples · 30-day ${fmtMetric("hrv_rmssd", hrv.mean30)}` : undefined} muted={!hrv?.ready} />
        </MetricStrip>
      </section>

      <section aria-labelledby="heart-charts">
        <SectionHeader title={<span id="heart-charts">Trends</span>} hint="60 days, dashed line is your 90-day median" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div><MetricChart days={days} metric="resting_hr" baseline={rhr} /></div>
          <div><MetricChart days={days} metric="hrv_rmssd" baseline={hrv} /></div>
          <div><MetricChart days={days} metric="recovery_score" baseline={baselines.recovery_score} height={140} /></div>
          <div><MetricChart days={days} metric="workout_avg_hr" baseline={baselines.workout_avg_hr} height={140} /></div>
        </div>
      </section>

      <section aria-labelledby="heart-findings">
        <SectionHeader title={<span id="heart-findings">Findings</span>} count={events.length} />
        <FindingList events={events} today={today} />
      </section>

      <section aria-labelledby="heart-correlations">
        <SectionHeader title={<span id="heart-correlations">Relationships</span>} count={correlations.length} />
        <CorrelationTable rows={correlations} />
      </section>
    </div>
  );
}
