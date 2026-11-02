"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LineChart, type LineSeries } from "@/components/finance/charts";
import { cn } from "@/lib/utils";
import { setEventStatus } from "@/actions/intel";
import type { IntelDerived, IntelEvent, IntelInsight } from "@/lib/data/intel";
import { METRICS, type Baseline, type DailySummary, type MetricKey, type Severity } from "@/lib/intel/types";
import { fmtMetric } from "@/lib/intel/findings";
import { formatDate } from "@/lib/dates";

export const SEVERITY_LABEL: Record<Severity, string> = { info: "Info", low: "Low", moderate: "Moderate", high: "High" };
const SEVERITY_VARIANT: Record<Severity, "muted" | "secondary" | "warning" | "destructive"> = { info: "muted", low: "secondary", moderate: "warning", high: "destructive" };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge variant={SEVERITY_VARIANT[severity]}>{SEVERITY_LABEL[severity]}</Badge>;
}

/** One detection with its evidence, the way the brief asks: measurement, baseline, difference, method, completeness, explanation, next step. */
export function FindingCard({ event, today, onChanged }: { event: IntelEvent; today: string; onChanged?: () => void }) {
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const metric = event.metric ? METRICS[event.metric] : null;
  const toggle = (status: "open" | "dismissed") =>
    startTransition(async () => {
      const res = await setEventStatus(event.id, status);
      if (res.ok) onChanged?.();
      else toast.error(res.error);
    });
  return (
    <article className={cn("border-line-1 rounded-lg border p-4", event.status === "dismissed" && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={event.severity} />
            <h3 className="text-text-1 text-sm font-medium">{event.title}</h3>
          </div>
          <p className="text-text-3 text-meta nums mt-1">
            {formatDate(event.day, "medium", today)} · {event.engine} · {event.kind}
            {event.status !== "open" ? ` · ${event.status}` : ""}
          </p>
        </div>
        {metric && event.value != null && event.kind !== "correlation" ? (
          <div className="nums text-right text-sm">
            <p className="text-text-1">{fmtMetric(event.metric!, event.value)}</p>
            {event.baseline != null ? (
              <p className="text-text-3 text-meta">
                baseline {fmtMetric(event.metric!, event.baseline)}
                {event.delta_pct != null ? ` (${event.delta_pct > 0 ? "+" : ""}${Math.round(event.delta_pct)}%)` : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="text-text-2 mt-3 text-sm leading-relaxed">{event.explanation}</p>
      {event.next_step ? <p className="text-text-2 mt-2 text-sm leading-relaxed"><span className="text-text-3">Next step: </span>{event.next_step}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-text-3 text-meta nums">Method: {event.method} · data completeness {Math.round(event.completeness * 100)}%</p>
        <div className="ml-auto flex gap-1">
          {event.evidence ? (
            <Button variant="ghost" size="xs" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide evidence" : "Evidence"}
            </Button>
          ) : null}
          {event.status === "dismissed" ? (
            <Button variant="ghost" size="xs" disabled={pending} onClick={() => toggle("open")}>
              Reopen
            </Button>
          ) : event.status === "open" ? (
            <Button variant="ghost" size="xs" disabled={pending} onClick={() => toggle("dismissed")}>
              Dismiss
            </Button>
          ) : null}
        </div>
      </div>
      {open && event.evidence ? <pre className="bg-surface-2 text-text-2 nums mt-3 max-h-64 overflow-auto rounded-md p-3 text-[11px] leading-relaxed">{JSON.stringify(event.evidence, null, 2)}</pre> : null}
    </article>
  );
}

export function FindingList({ events, today, empty = "Nothing detected in this area.", limit }: { events: IntelEvent[]; today: string; empty?: string; limit?: number }) {
  const router = useRouter();
  const shown = limit ? events.slice(0, limit) : events;
  if (!shown.length) return <EmptyState className="mt-3" title={empty} description="Detections appear here when your data deviates from your own baselines. No detection does not mean everything is fine." />;
  return (
    <div className="mt-3 space-y-3">
      {shown.map((e) => (
        <FindingCard key={e.id} event={e} today={today} onChanged={() => router.refresh()} />
      ))}
    </div>
  );
}

/** Ranked feed for the Overview. */
export function InsightFeed({ insights }: { insights: IntelInsight[] }) {
  if (!insights.length) return <EmptyState className="mt-3" title="No insights yet" description="Offload your strap a few times first. Insights need at least a couple of weeks of nights." />;
  return (
    <ol className="hairline-rows -mx-2 mt-3">
      {insights.map((i) => (
        <li key={i.id} className="px-2 py-3">
          <div className="flex items-start gap-3">
            <span className="nums text-text-3 mt-0.5 w-5 shrink-0 text-right text-[11px]">{i.rank}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {i.severity !== "info" ? <SeverityBadge severity={i.severity} /> : null}
                <p className="text-text-1 text-sm font-medium">{i.href ? <Link href={i.href} className="hover:underline">{i.title}</Link> : i.title}</p>
              </div>
              <p className="text-text-2 mt-1 text-sm leading-relaxed">{i.body}</p>
              {i.recommendation ? <p className="text-text-3 mt-1 text-sm">{i.recommendation}</p> : null}
              <p className="text-text-3 text-meta nums mt-1">
                {i.category}
                {i.confidence != null ? ` · confidence ${Math.round(i.confidence * 100)}%` : ""}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A FRADY score with its transparent factor breakdown. */
export function ScorePanel({ score, label, description, inverted = false }: { score: IntelDerived | null; label: string; description: string; inverted?: boolean }) {
  const v = score?.value ?? null;
  const tone = v == null ? "text-text-3" : inverted ? (v >= 70 ? "text-danger" : v >= 40 ? "text-warning" : "text-success") : v >= 70 ? "text-success" : v >= 40 ? "text-warning" : "text-danger";
  return (
    <div className="border-line-1 bg-surface-1 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-text-3 text-meta">{label}</p>
          <p className={cn("nums mt-1 text-4xl font-semibold tracking-tight", tone)}>{v == null ? "--" : Math.round(v)}</p>
        </div>
        {score ? <p className="text-text-3 text-meta nums text-right">{score.formula_version} · completeness {Math.round(score.completeness * 100)}%</p> : null}
      </div>
      <p className="text-text-3 mt-2 text-sm">{description}</p>
      {score?.factors.length ? (
        <ul className="mt-3 space-y-2">
          {score.factors.map((f) => (
            <li key={f.key}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-text-1">{f.label}</span>
                <span className="nums text-text-3 text-meta">weight {f.weight} · {f.score == null ? "no data" : Math.round(f.score)}</span>
              </div>
              <div className="bg-surface-3 mt-1 h-1 w-full overflow-hidden rounded-full">
                <div className="bg-brand h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, f.score ?? 0))}%` }} />
              </div>
              <p className="text-text-3 text-meta mt-1">{f.detail}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {score?.note ? <p className="text-text-3 mt-3 text-xs leading-relaxed">{score.note}</p> : null}
    </div>
  );
}

/** Metric over the last n days with the personal 90-day median as a dashed reference. */
export function MetricChart({ days, metric, baseline, n = 60, height = 180 }: { days: DailySummary[]; metric: MetricKey; baseline?: Baseline | null; n?: number; height?: number }) {
  const rows = days.slice(-n);
  const values = rows.map((d) => (d.scored ? d[metric] : null));
  if (!values.some((v) => v != null)) return <EmptyState className="mt-3" title={`No ${METRICS[metric].label.toLowerCase()} data`} />;
  const meta = METRICS[metric];
  const median = baseline?.median90 ?? null;
  const xLabels = rows.map((d) => `${Number(d.day.slice(5, 7))}/${Number(d.day.slice(8, 10))}`);
  const series: LineSeries[] = [{ id: metric, name: meta.label, color: "var(--chart-1)", values }];
  if (median != null) series.push({ id: "median", name: "90-day median", color: "var(--text-3)", values: rows.map(() => median), dashed: true });
  return <LineChart className="mt-3" xLabels={xLabels} series={series} height={height} zeroLine={false} yFormat={(v) => fmtMetric(metric, v)} ariaLabel={`${meta.label} over the last ${rows.length} days`} />;
}

/** Score history as a line, 0..100. */
export function ScoreChart({ rows, label, height = 160 }: { rows: { day: string; value: number | null }[]; label: string; height?: number }) {
  if (!rows.some((r) => r.value != null)) return null;
  return <LineChart className="mt-3" xLabels={rows.map((d) => `${Number(d.day.slice(5, 7))}/${Number(d.day.slice(8, 10))}`)} series={[{ id: "score", name: label, color: "var(--chart-1)", values: rows.map((r) => r.value) }]} height={height} zeroLine={false} yFormat={(v) => String(Math.round(v))} ariaLabel={`${label} over time`} />;
}

export function Freshness({ day, today }: { day: string | null | undefined; today: string }) {
  if (!day) return <span className="text-text-3 text-meta">no data</span>;
  const age = Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
  return <span className={cn("text-meta nums", age > 2 ? "text-warning" : "text-text-3")}>{age <= 0 ? "today" : age === 1 ? "yesterday" : `${age} days old`}</span>;
}
