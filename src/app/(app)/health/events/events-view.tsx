"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/app/items";
import { FindingList } from "@/components/health/intel";
import { saveIntelPreferences, setRuleEnabled } from "@/actions/intel";
import type { IntelEvent, IntelJob, IntelPreferences } from "@/lib/data/intel";
import type { EngineKey, Severity } from "@/lib/intel/types";
import { ENGINE_LABELS } from "@/lib/intel/engines";
import { formatTimestamp } from "@/lib/dates";

type Rule = { rule: string; label: string; description: string; engine: EngineKey };
type Filter = "open" | "dismissed" | "resolved";

export function EventsView({ events, rules, disabled, preferences, jobs, disclaimer, today }: { events: IntelEvent[]; rules: Rule[]; disabled: string[]; preferences: IntelPreferences; jobs: IntelJob[]; disclaimer: string; today: string }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>("open");
  const [severity, setSeverity] = React.useState<Severity | "all">("all");
  const [showRules, setShowRules] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [prefs, setPrefs] = React.useState(preferences);

  const shown = events.filter((e) => e.status === filter && e.kind !== "status" && (severity === "all" || e.severity === severity));
  const disabledSet = new Set(disabled);

  function toggleRule(rule: string, enabled: boolean) {
    startTransition(async () => {
      const res = await setRuleEnabled(rule, enabled);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }
  function savePrefs() {
    startTransition(async () => {
      const res = await saveIntelPreferences(prefs);
      if (res.ok) {
        toast.success("Preferences saved. They apply at the next recompute.");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  const byEngine = rules.reduce<Record<string, Rule[]>>((acc, r) => ((acc[r.engine] ??= []).push(r), acc), {});

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="ev-list">
        <SectionHeader
          title={<span id="ev-list">Detected events</span>}
          count={shown.length}
          action={
            <div className="flex flex-wrap gap-1">
              {(["open", "dismissed", "resolved"] as Filter[]).map((f) => (
                <Button key={f} size="xs" variant={filter === f ? "secondary" : "ghost"} onClick={() => setFilter(f)}>
                  {f}
                </Button>
              ))}
              <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity | "all")} className="bg-surface-1 border-line-1 text-text-2 h-7 rounded-md border px-2 text-xs" aria-label="Severity">
                <option value="all">all severities</option>
                <option value="high">high</option>
                <option value="moderate">moderate</option>
                <option value="low">low</option>
                <option value="info">info</option>
              </select>
            </div>
          }
        />
        <FindingList events={shown} today={today} empty={filter === "open" ? "No open events" : `No ${filter} events`} />
        <p className="text-text-3 mt-3 text-xs leading-relaxed">{disclaimer}</p>
      </section>

      <section aria-labelledby="ev-prefs">
        <SectionHeader title={<span id="ev-prefs">Sensitivity and notifications</span>} />
        <div className="border-line-1 mt-3 grid gap-4 rounded-lg border p-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="text-text-2 block">Personal deviation threshold (MAD units)</span>
            <input type="number" min={1} max={4} step={0.25} value={prefs.z_moderate} onChange={(e) => setPrefs({ ...prefs, z_moderate: Number(e.target.value) })} className="bg-surface-1 border-line-1 nums mt-1 h-9 w-full rounded-md border px-2" />
            <span className="text-text-3 text-meta">2 is the default; lower is more sensitive.</span>
          </label>
          <label className="text-sm">
            <span className="text-text-2 block">Days a deviation must persist</span>
            <input type="number" min={2} max={7} value={prefs.persist_days} onChange={(e) => setPrefs({ ...prefs, persist_days: Number(e.target.value) })} className="bg-surface-1 border-line-1 nums mt-1 h-9 w-full rounded-md border px-2" />
          </label>
          <label className="text-sm">
            <span className="text-text-2 block">Notify in the app from severity</span>
            <select value={prefs.min_severity} onChange={(e) => setPrefs({ ...prefs, min_severity: e.target.value as Severity })} className="bg-surface-1 border-line-1 mt-1 h-9 w-full rounded-md border px-2">
              <option value="low">low</option>
              <option value="moderate">moderate</option>
              <option value="high">high</option>
            </select>
          </label>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.in_app} onChange={(e) => setPrefs({ ...prefs, in_app: e.target.checked })} /> In-app notifications</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.email} onChange={(e) => setPrefs({ ...prefs, email: e.target.checked })} /> Email (uses the reminders email when enabled in Settings)</label>
            <Button size="sm" className="mt-auto w-fit" onClick={savePrefs} disabled={pending}>Save</Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="ev-rules">
        <SectionHeader title={<span id="ev-rules">Detection rules</span>} count={rules.length} action={<Button size="xs" variant="ghost" onClick={() => setShowRules((v) => !v)}>{showRules ? "Hide" : "Show"}</Button>} />
        {showRules ? (
          <div className="mt-3 space-y-5">
            {Object.entries(byEngine).map(([engine, list]) => (
              <div key={engine}>
                <p className="text-text-3 text-meta uppercase tracking-wide">{ENGINE_LABELS[engine as EngineKey]}</p>
                <div className="hairline-rows -mx-2 mt-1">
                  {list.map((r) => (
                    <label key={r.rule} className="flex items-start gap-3 px-2 py-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={!disabledSet.has(r.rule)} disabled={pending} onChange={(e) => toggleRule(r.rule, e.target.checked)} />
                      <span>
                        <span className="text-text-1">{r.label}</span>
                        <span className="text-text-3 text-meta block">{r.description} · {r.rule}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="ev-jobs">
        <SectionHeader title={<span id="ev-jobs">Processing</span>} />
        <div className="hairline-rows -mx-2 mt-3">
          {jobs.length ? jobs.map((j) => (
            <div key={j.id} className="flex items-center justify-between gap-3 px-2 py-2 text-sm">
              <span className="text-text-1">{j.kind} · {j.status}{j.error ? ` · ${j.error}` : ""}</span>
              <span className="text-text-3 text-meta nums">{formatTimestamp(j.started_at)}{j.stats ? ` · ${String((j.stats as { findings?: number }).findings ?? 0)} findings` : ""}</span>
            </div>
          )) : <p className="text-text-3 px-2 py-2 text-sm">No runs yet.</p>}
        </div>
      </section>
    </div>
  );
}
