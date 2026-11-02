"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HeartPulse, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import { Freshness, InsightFeed, ScorePanel } from "@/components/health/intel";
import { recomputeIntelligence } from "@/actions/intel";
import type { IntelData } from "@/lib/data/intel";
import { fmtMetric } from "@/lib/intel/findings";
import type { MetricKey } from "@/lib/intel/types";
import { recoveryTone, strainTone } from "@/lib/health/stats";

/** The Health Intelligence front page: six status cards, the readiness score, and the ranked insight feed. */
export function OverviewView({ intel, healthEmpty, today }: { intel: IntelData; healthEmpty: boolean; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  if (healthEmpty && !intel.days.length) {
    return (
      <EmptyState
        variant="page"
        icon={<HeartPulse />}
        title="No health data yet"
        description="Pair your strap on the Strap tab and offload its history. The intelligence layer builds personal baselines from what the strap holds."
        action={
          <Button asChild size="sm">
            <Link href="/health/strap">Pair a strap</Link>
          </Button>
        }
      />
    );
  }

  const latest = [...intel.days].reverse().find((d) => d.scored && d.completeness > 0) ?? intel.days[intel.days.length - 1];
  const b = (k: MetricKey) => intel.baselines[k];
  const vsBaseline = (k: MetricKey) => {
    const base = b(k);
    const v = latest?.[k];
    if (base?.median90 == null || v == null) return undefined;
    const d = ((v - base.median90) / Math.abs(base.median90)) * 100;
    return `${d >= 0 ? "+" : ""}${Math.round(d)}% vs 90-day median`;
  };
  // The most recent day that actually has a score; today may have no readings yet.
  const score = (key: IntelData["derived"][number]["key"]) => [...intel.derived].reverse().find((d) => d.key === key && d.value != null) ?? [...intel.derived].reverse().find((d) => d.key === key) ?? null;
  const readiness = score("readiness");
  const sqi = score("sleep_quality_index");
  const openEvents = intel.events.filter((e) => e.status === "open" && e.kind !== "status");
  const deviations = openEvents.filter((e) => e.kind === "deviation" && (e.severity === "moderate" || e.severity === "high"));
  const cardioStatus = (() => {
    const rhr = b("resting_hr");
    const hrv = b("hrv_rmssd");
    if (!rhr?.ready || !hrv?.ready) return { value: "Learning", sub: `${Math.max(rhr?.n ?? 0, hrv?.n ?? 0)} of 14 days`, tone: "neutral" as const };
    const rhrUp = rhr.rateOfChange != null && rhr.rateOfChange > 5;
    const hrvDown = hrv.rateOfChange != null && hrv.rateOfChange < -10;
    if (rhrUp && hrvDown) return { value: "Strained", sub: "RHR up, HRV down this week", tone: "warning" as const };
    if (rhrUp || hrvDown) return { value: "Watch", sub: rhrUp ? "RHR above its 30-day mean" : "HRV below its 30-day mean", tone: "warning" as const };
    return { value: "At baseline", sub: `RHR ${fmtMetric("resting_hr", rhr.median90)} · HRV ${fmtMetric("hrv_rmssd", hrv.median90)}`, tone: "good" as const };
  })();

  function recompute() {
    startTransition(async () => {
      const res = await recomputeIntelligence();
      if (res.ok) {
        toast.success(`Recomputed: ${res.data.findings} findings, ${res.data.newEvents} new.`);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {intel.notReady ? (
        <EmptyState title="Health Intelligence is not set up yet" description="Run supabase/migrations/0013_biometrics.sql in the Supabase SQL editor, then press Recompute." action={<Button size="sm" variant="outline" onClick={recompute} disabled={pending}><RefreshCw /> Recompute</Button>} />
      ) : null}

      <section aria-labelledby="hi-status">
        <SectionHeader
          title={<span id="hi-status">Today</span>}
          hint={latest ? <>Latest data <Freshness day={latest.day} today={today} /></> : undefined}
          action={
            <Button size="xs" variant="ghost" onClick={recompute} disabled={pending} aria-label="Recompute">
              <RefreshCw className={pending ? "animate-spin" : undefined} /> Recompute
            </Button>
          }
        />
        <MetricStrip cols={2} className="mt-3 md:grid-cols-3 lg:grid-cols-6">
          <Metric size="sm" label="Recovery" value={fmtMetric("recovery_score", latest?.recovery_score)} sub={vsBaseline("recovery_score")} tone={recoveryTone(latest?.recovery_score)} muted={latest?.recovery_score == null} href="/health/heart" />
          <Metric size="sm" label="Sleep quality" value={sqi?.value != null ? String(Math.round(sqi.value)) : "--"} sub={latest?.sleep_total_min != null ? `${fmtMetric("sleep_total_min", latest.sleep_total_min)} slept` : undefined} tone={sqi?.value == null ? "neutral" : sqi.value >= 70 ? "good" : sqi.value >= 50 ? "neutral" : "warning"} muted={sqi?.value == null} href="/health/sleep" />
          <Metric size="sm" label="Cardio baseline" value={cardioStatus.value} sub={cardioStatus.sub} tone={cardioStatus.tone} href="/health/heart" />
          <Metric size="sm" label="Day strain" value={fmtMetric("day_strain", latest?.day_strain)} sub={vsBaseline("day_strain")} tone={strainTone(latest?.day_strain)} muted={latest?.day_strain == null} href="/health/load" />
          <Metric size="sm" label="Steps" value="No source" sub="Not derived from the strap" muted href="/health/load" />
          <Metric size="sm" label="Deviations" value={deviations.length ? String(deviations.length) : "None"} sub={deviations.length ? deviations[0].title : `${openEvents.length} open findings`} tone={deviations.some((d) => d.severity === "high") ? "serious" : deviations.length ? "warning" : "good"} href="/health/events" />
        </MetricStrip>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-labelledby="hi-insights">
          <SectionHeader title={<span id="hi-insights">Insights</span>} count={intel.insights.length} />
          <InsightFeed insights={intel.insights} />
        </section>
        <section aria-labelledby="hi-readiness">
          <SectionHeader title={<span id="hi-readiness">Readiness</span>} />
          <div className="mt-3">
            <ScorePanel score={readiness} label="FRADY Readiness" description="FRADY's own score from HRV and resting heart rate against your baselines, sleep sufficiency, recent strain and recent recovery. It is FRADY's own number and says nothing about medical fitness." />
          </div>
        </section>
      </div>

      <p className="text-text-3 text-xs leading-relaxed">Everything on this page is a comparison with your own history, not a diagnosis. No finding does not mean you are well. If something persists or you feel unwell, talk to a clinician.</p>
    </div>
  );
}
