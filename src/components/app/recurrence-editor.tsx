"use client";

import * as React from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { describeRecurrence } from "@/lib/recurrence";
import type { RecurrenceRule } from "@/lib/types";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function RecurrenceEditor({ value, onChange }: { value: RecurrenceRule | null; onChange: (v: RecurrenceRule | null) => void }) {
  const rule = value;
  function set(patch: Partial<RecurrenceRule>) {
    onChange({ freq: "weekly", interval: 1, basis: "due", ...(rule ?? {}), ...patch });
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="w-full sm:w-auto">Repeats</Label>
        <NativeSelect
          className="sm:w-40"
          value={rule?.freq ?? ""}
          onChange={(e) => (e.target.value ? set({ freq: e.target.value as RecurrenceRule["freq"] }) : onChange(null))}
          aria-label="Repeat frequency"
        >
          <option value="">Never</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </NativeSelect>
        {rule ? (
          <div className="text-text-2 flex items-center gap-1.5 text-sm">
            every
            <Input type="number" min={1} max={365} className="nums w-16" value={rule.interval} onChange={(e) => set({ interval: Math.max(1, parseInt(e.target.value || "1", 10)) })} aria-label="Interval" />
            {rule.freq === "daily" ? "day(s)" : rule.freq === "weekly" ? "week(s)" : rule.freq === "monthly" ? "month(s)" : "year(s)"}
          </div>
        ) : null}
      </div>
      {rule?.freq === "weekly" ? (
        <div className="flex items-center gap-1" role="group" aria-label="Weekdays">
          {DAYS.map((d, i) => {
            const on = rule.byWeekday?.includes(i) ?? false;
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                aria-label={DAY_NAMES[i]}
                title={DAY_NAMES[i]}
                onClick={() => {
                  const cur = new Set(rule.byWeekday ?? []);
                  if (on) cur.delete(i);
                  else cur.add(i);
                  set({ byWeekday: Array.from(cur).sort() });
                }}
                className={cn(
                  "focus-visible:ring-brand/40 size-8 rounded-full border text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2",
                  on ? "bg-brand text-primary-foreground border-brand" : "border-line-2 text-text-2 hover:bg-surface-2 hover:text-text-1",
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      ) : null}
      {rule ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <NativeSelect className="sm:w-56" value={rule.basis} onChange={(e) => set({ basis: e.target.value as RecurrenceRule["basis"] })} aria-label="Next date basis">
            <option value="due">Next date from the due date</option>
            <option value="completion">Next date from when I complete it</option>
          </NativeSelect>
          <span className="text-text-3">until</span>
          <Input type="date" className="nums w-40" value={rule.until ?? ""} onChange={(e) => set({ until: e.target.value || null })} aria-label="Repeat until" />
        </div>
      ) : null}
      <p className="text-text-3 text-xs">{describeRecurrence(rule)}. Completing this task creates the next occurrence.</p>
    </div>
  );
}
