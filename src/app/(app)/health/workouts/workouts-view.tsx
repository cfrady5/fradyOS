"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader, SubHeading } from "@/components/app/items";
import { Metric, MetricStrip } from "@/components/app/metric";
import type { HealthWorkoutRow } from "@/lib/data/health";
import { durationMin, fmt0, fmt1, fmtHours, windowDays } from "@/lib/health/stats";
import { formatDate, formatTimestamp } from "@/lib/dates";

/** Workouts grouped by day, newest first, with a 30-day roll-up above. */
export function WorkoutsView({ workouts, today }: { workouts: HealthWorkoutRow[]; today: string }) {
  if (!workouts.length) {
    return (
      <EmptyState
        variant="page"
        title="No workouts yet"
        description="Import a WHOOP or NOOP export that includes workouts.csv and they show up here."
        action={
          <Button asChild size="sm">
            <Link href="/health/data">Import an export</Link>
          </Button>
        }
      />
    );
  }
  const month = windowDays(workouts, today, 30);
  const minutes = month.reduce((s, w) => s + durationMin(w.start_at, w.end_at), 0);
  const strain = month.reduce((s, w) => s + (w.strain ?? 0), 0);
  const kcal = month.reduce((s, w) => s + (w.energy_kcal ?? 0), 0);
  const byDay = new Map<string, HealthWorkoutRow[]>();
  for (const w of [...workouts].reverse()) {
    const list = byDay.get(w.day) ?? [];
    list.push(w);
    byDay.set(w.day, list);
  }
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="workouts-month">
        <SectionHeader index="01" title={<span id="workouts-month">Last 30 days</span>} />
        <MetricStrip cols={2} className="mt-3 md:grid-cols-4">
          <Metric label="Workouts" value={fmt0(month.length)} muted={!month.length} />
          <Metric label="Time" value={fmtHours(minutes)} muted={!minutes} />
          <Metric label="Strain" value={fmt0(strain)} muted={!strain} />
          <Metric label="Energy" value={kcal ? `${fmt0(kcal)} kcal` : "–"} muted={!kcal} />
        </MetricStrip>
      </section>
      <section aria-labelledby="workouts-all">
        <SectionHeader index="02" title={<span id="workouts-all">All workouts</span>} count={workouts.length} />
        <div className="mt-2">
          {[...byDay.entries()].map(([day, list]) => (
            <React.Fragment key={day}>
              <SubHeading count={list.length}>{formatDate(day, "long", today)}</SubHeading>
              <ul className="divide-line-1 divide-y">
                {list.map((w) => (
                  <li key={w.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-2.5 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
                    <div className="min-w-0">
                      <p className="text-text-1 truncate text-sm font-medium">{w.activity}</p>
                      <p className="text-text-3 text-meta nums">{formatTimestamp(w.start_at)} · {fmtHours(durationMin(w.start_at, w.end_at))}</p>
                    </div>
                    <Cell label="Strain" value={fmt1(w.strain)} />
                    <Cell label="Avg HR" value={w.avg_hr != null ? `${w.avg_hr} bpm` : "–"} hideOnPhone />
                    <Cell label="Max HR" value={w.max_hr != null ? `${w.max_hr} bpm` : "–"} hideOnPhone />
                    <Cell label="Energy" value={w.energy_kcal != null ? `${fmt0(w.energy_kcal)} kcal` : "–"} hideOnPhone />
                  </li>
                ))}
              </ul>
            </React.Fragment>
          ))}
        </div>
      </section>
    </div>
  );
}

function Cell({ label, value, hideOnPhone }: { label: string; value: string; hideOnPhone?: boolean }) {
  return (
    <div className={hideOnPhone ? "hidden text-right md:block" : "text-right"}>
      <p className="eyebrow">{label}</p>
      <p className={`nums text-sm ${value === "–" ? "text-text-3" : "text-text-1"}`}>{value}</p>
    </div>
  );
}
