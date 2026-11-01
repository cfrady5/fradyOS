"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/app/items";
import { FindingList } from "@/components/health/intel";
import { deleteBehavior, logBehavior } from "@/actions/intel";
import type { IntelEvent } from "@/lib/data/intel";
import type { BehaviorEntry, BehaviorKind } from "@/lib/intel/types";
import { formatDate, formatTimestamp } from "@/lib/dates";

type Insight = { key: string; kind: BehaviorKind; outcome: string; condition: string; withMean: number; withoutMean: number; diff: number; ci: [number, number]; nWith: number; nWithout: number; period: { from: string; to: string }; confounders: string[]; text: string };

const KINDS: { kind: BehaviorKind; label: string; unit?: string; amount?: string }[] = [
  { kind: "caffeine", label: "Caffeine", unit: "mg", amount: "mg" },
  { kind: "alcohol", label: "Alcohol", unit: "units", amount: "units" },
  { kind: "water", label: "Water", unit: "ml", amount: "ml" },
  { kind: "meal", label: "Meal" },
  { kind: "calories", label: "Calories", unit: "kcal", amount: "kcal" },
  { kind: "protein", label: "Protein", unit: "g", amount: "g" },
  { kind: "exercise", label: "Exercise timing" },
  { kind: "bedtime_routine", label: "Bedtime routine" },
  { kind: "supplement", label: "Supplement" },
  { kind: "stress", label: "Stressful event" },
  { kind: "travel", label: "Travel" },
  { kind: "illness", label: "Feeling unwell" },
  { kind: "medication", label: "Medication (private)" },
];

export function HabitsView({ behaviors, insights, events, today }: { behaviors: BehaviorEntry[]; insights: Insight[]; events: IntelEvent[]; today: string; timezone: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [kind, setKind] = React.useState<BehaviorKind>("caffeine");
  const formRef = React.useRef<HTMLFormElement>(null);
  const meta = KINDS.find((k) => k.kind === kind)!;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await logBehavior(fd);
      if (res.ok) {
        toast.success("Logged.");
        formRef.current?.reset();
        router.refresh();
      } else toast.error(res.error);
    });
  }
  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteBehavior(id);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="hb-log">
        <SectionHeader title={<span id="hb-log">Log something</span>} hint="Manual entries, not sensor data" />
        <form ref={formRef} onSubmit={submit} className="border-line-1 mt-3 grid gap-3 rounded-lg border p-4 md:grid-cols-6">
          <label className="text-sm md:col-span-2">
            <span className="text-text-2 block">What</span>
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as BehaviorKind)} className="bg-surface-1 border-line-1 mt-1 h-9 w-full rounded-md border px-2">
              {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-text-2 block">Day</span>
            <input name="day" type="date" defaultValue={today} required className="bg-surface-1 border-line-1 nums mt-1 h-9 w-full rounded-md border px-2" />
          </label>
          <label className="text-sm">
            <span className="text-text-2 block">Time</span>
            <input name="time" type="time" className="bg-surface-1 border-line-1 nums mt-1 h-9 w-full rounded-md border px-2" />
          </label>
          <label className="text-sm">
            <span className="text-text-2 block">Amount{meta.amount ? ` (${meta.amount})` : ""}</span>
            <input name="amount" type="number" step="any" min={0} disabled={!meta.amount} className="bg-surface-1 border-line-1 nums mt-1 h-9 w-full rounded-md border px-2 disabled:opacity-50" />
            <input type="hidden" name="unit" value={meta.unit ?? ""} />
          </label>
          <label className="text-sm md:col-span-5">
            <span className="text-text-2 block">Note</span>
            <input name="note" type="text" maxLength={500} placeholder={kind === "supplement" ? "e.g. magnesium" : kind === "medication" ? "Kept private; never shown in insights" : ""} className="bg-surface-1 border-line-1 mt-1 h-9 w-full rounded-md border px-2" />
          </label>
          <div className="flex items-end">
            <Button type="submit" size="sm" disabled={pending}>Log</Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="hb-insights">
        <SectionHeader title={<span id="hb-insights">What the logs show</span>} count={insights.length} />
        {insights.length ? (
          <div className="hairline-rows -mx-2 mt-3">
            {insights.map((i) => (
              <div key={i.key} className="px-2 py-3">
                <p className="text-text-1 text-sm leading-relaxed">{i.text}</p>
                <p className="text-text-3 text-meta nums mt-1">
                  n = {i.nWith} with, {i.nWithout} without · {i.period.from} to {i.period.to}
                  {i.confounders.length ? ` · possible confounders: ${i.confounders.join(", ")}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState className="mt-3" title="No supported statements yet" description="A statement appears only when at least five logged days and five comparable days exist and the difference is unlikely to be noise. Keep logging." />
        )}
        <FindingList events={events} today={today} empty="No behaviour findings" />
      </section>

      <section aria-labelledby="hb-list">
        <SectionHeader title={<span id="hb-list">Recent entries</span>} count={behaviors.length} />
        {behaviors.length ? (
          <div className="hairline-rows -mx-2 mt-3">
            {behaviors.slice(0, 60).map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 px-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-text-1">{KINDS.find((k) => k.kind === b.kind)?.label ?? b.kind}{b.amount != null ? ` · ${b.amount}${b.unit ? ` ${b.unit}` : ""}` : ""}{b.note && b.kind !== "medication" ? ` · ${b.note}` : ""}</p>
                  <p className="text-text-3 text-meta nums">{b.at ? formatTimestamp(b.at) : formatDate(b.day, "medium", today)}</p>
                </div>
                <Button variant="ghost" size="icon-xs" aria-label="Delete entry" disabled={pending} onClick={() => remove(b.id)}><Trash2 /></Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState className="mt-3" title="Nothing logged yet" />
        )}
      </section>
    </div>
  );
}
