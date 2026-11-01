"use client";

import { SectionHeader } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import { FindingList, MetricChart } from "@/components/health/intel";
import type { IntelEvent } from "@/lib/data/intel";
import { fmtMetric } from "@/lib/intel/findings";
import { METRICS, type Baseline, type DailySummary, type MetricKey } from "@/lib/intel/types";

type Panel = { metric: MetricKey; value: number | null; baseline: number | null; z: number | null; direction: "up" | "down" | "flat" | null; ready: boolean }[];

export function BreathingView({ days, baselines, panel, events, today }: { days: DailySummary[]; baselines: Record<MetricKey, Baseline>; panel: Panel; events: IntelEvent[]; today: string }) {
  const latest = [...days].reverse().find((d) => d.scored && (d.resp_rate != null || d.spo2 != null || d.skin_temp != null));
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="br-now">
        <SectionHeader title={<span id="br-now">Overnight</span>} hint={latest ? `As of ${latest.day}` : undefined} />
        <MetricStrip cols={3} className="mt-3">
          <Metric size="sm" label="Respiratory rate" value={fmtMetric("resp_rate", latest?.resp_rate)} sub={baselines.resp_rate?.median90 != null ? `baseline ${fmtMetric("resp_rate", baselines.resp_rate.median90)}` : undefined} muted={latest?.resp_rate == null} />
          <Metric size="sm" label="Blood oxygen" value={fmtMetric("spo2", latest?.spo2)} sub={baselines.spo2?.median90 != null ? `baseline ${fmtMetric("spo2", baselines.spo2.median90)}` : undefined} tone={latest?.spo2 != null && latest.spo2 < 90 ? "serious" : "neutral"} muted={latest?.spo2 == null} />
          <Metric size="sm" label="Skin temperature" value={fmtMetric("skin_temp", latest?.skin_temp)} sub={baselines.skin_temp?.median90 != null ? `baseline ${fmtMetric("skin_temp", baselines.skin_temp.median90)}` : undefined} muted={latest?.skin_temp == null} />
        </MetricStrip>
      </section>

      <section aria-labelledby="br-panel">
        <SectionHeader title={<span id="br-panel">Physiological deviation panel</span>} hint="Each overnight measure against your own 90-day median, in MAD units" />
        <div className="hairline-rows -mx-2 mt-3">
          {panel.map((p) => (
            <div key={p.metric} className="flex items-center justify-between gap-4 px-2 py-2.5">
              <div>
                <p className="text-text-1 text-sm font-medium">{METRICS[p.metric].label}</p>
                <p className="text-text-3 text-meta nums">{p.ready ? `${fmtMetric(p.metric, p.value)} vs ${fmtMetric(p.metric, p.baseline)}` : "baseline still learning"}</p>
              </div>
              <p className={`nums text-sm ${p.z != null && Math.abs(p.z) >= 2 ? "text-warning" : "text-text-2"}`}>{p.z == null ? "--" : `${p.z >= 0 ? "+" : ""}${p.z.toFixed(1)} ${p.direction ?? ""}`}</p>
            </div>
          ))}
        </div>
        <p className="text-text-3 mt-2 text-xs leading-relaxed">Several measures moving together (temperature and resting heart rate up, HRV down, breathing faster) is a deviation worth watching, not a diagnosis of anything.</p>
      </section>

      <section aria-labelledby="br-charts">
        <SectionHeader title={<span id="br-charts">Trends</span>} hint="60 days, dashed line is your 90-day median" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div><MetricChart days={days} metric="resp_rate" baseline={baselines.resp_rate} height={150} /></div>
          <div><MetricChart days={days} metric="spo2" baseline={baselines.spo2} height={150} /></div>
          <div><MetricChart days={days} metric="skin_temp" baseline={baselines.skin_temp} height={150} /></div>
        </div>
      </section>

      <section aria-labelledby="br-findings">
        <SectionHeader title={<span id="br-findings">Findings</span>} count={events.length} />
        <FindingList events={events} today={today} />
      </section>
    </div>
  );
}
