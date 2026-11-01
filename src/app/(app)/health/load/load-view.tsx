"use client";

import { SectionHeader } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import { LineChart } from "@/components/finance/charts";
import { FindingList, MetricChart, ScoreChart, ScorePanel } from "@/components/health/intel";
import type { IntelDerived, IntelEvent } from "@/lib/data/intel";
import { fmtMetric } from "@/lib/intel/findings";
import type { Baseline, DailySummary, MetricKey } from "@/lib/intel/types";

type Load = { acute: number | null; chronic: number | null; ratio: number | null; weeklyStrain: number[]; restDaysPerWeek: number | null };

function ratioTone(r: number | null): "neutral" | "good" | "warning" | "serious" {
  if (r == null) return "neutral";
  if (r < 0.8) return "neutral";
  if (r <= 1.3) return "good";
  if (r <= 1.5) return "warning";
  return "serious";
}

export function LoadView({ days, baselines, load, derived, events, today }: { days: DailySummary[]; baselines: Record<MetricKey, Baseline>; load: Load; derived: IntelDerived[]; events: IntelEvent[]; today: string }) {
  const pli = [...derived].reverse().find((d) => d.value != null) ?? derived[derived.length - 1] ?? null;
  const latest = [...days].reverse().find((d) => d.scored && d.day_strain != null);
  const weeks = load.weeklyStrain.map((_, i) => `wk ${i - load.weeklyStrain.length + 1 === 0 ? "now" : i - load.weeklyStrain.length + 1}`);
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="load-now">
        <SectionHeader title={<span id="load-now">Training load</span>} hint="Acute is the 7-day mean strain, chronic the 28-day mean" />
        <MetricStrip cols={2} className="mt-3 md:grid-cols-5">
          <Metric size="sm" label="Day strain" value={fmtMetric("day_strain", latest?.day_strain)} sub={latest ? latest.day : undefined} muted={latest?.day_strain == null} />
          <Metric size="sm" label="Acute (7d)" value={load.acute != null ? load.acute.toFixed(1) : "--"} muted={load.acute == null} />
          <Metric size="sm" label="Chronic (28d)" value={load.chronic != null ? load.chronic.toFixed(1) : "--"} muted={load.chronic == null} />
          <Metric size="sm" label="Acute:chronic" value={load.ratio != null ? load.ratio.toFixed(2) : "--"} sub="0.8 to 1.3 is the usual band" tone={ratioTone(load.ratio)} muted={load.ratio == null} />
          <Metric size="sm" label="Rest days / week" value={load.restDaysPerWeek != null ? load.restDaysPerWeek.toFixed(1) : "--"} muted={load.restDaysPerWeek == null} />
        </MetricStrip>
        {load.weeklyStrain.length ? <LineChart className="mt-4" xLabels={weeks} series={[{ id: "weekly", name: "Weekly strain", color: "var(--chart-1)", values: load.weeklyStrain }]} height={150} zeroLine={false} yFormat={(v) => String(Math.round(v))} ariaLabel="Weekly strain, last eight weeks" /> : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-labelledby="load-charts">
          <SectionHeader title={<span id="load-charts">Trends</span>} hint="60 days, dashed line is your 90-day median" />
          <MetricChart days={days} metric="day_strain" baseline={baselines.day_strain} />
          <MetricChart days={days} metric="energy_kcal" baseline={baselines.energy_kcal} height={140} />
          <MetricChart days={days} metric="workout_min" baseline={baselines.workout_min} height={140} />
          <ScoreChart rows={derived.slice(-60)} label="Physiological Load Index" />
        </section>
        <section aria-labelledby="load-pli">
          <SectionHeader title={<span id="load-pli">Physiological Load</span>} />
          <div className="mt-3">
            <ScorePanel score={pli} label="FRADY Physiological Load Index" description="Higher means more loaded. Daily, from overnight HRV and resting heart rate deviations, sleep deficiency, recent strain and the recovery trend. It is not WHOOP's Stress Monitor, it is not live, and it does not measure cortisol or mood." inverted />
          </div>
        </section>
      </div>

      <section aria-labelledby="load-findings">
        <SectionHeader title={<span id="load-findings">Findings</span>} count={events.length} />
        <FindingList events={events} today={today} />
      </section>
    </div>
  );
}
