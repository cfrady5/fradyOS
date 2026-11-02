"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RowList, SectionHeader } from "@/components/app/items";
import { HealthRow } from "@/components/health/bits";
import { Metric, MetricStrip } from "@/components/app/metric";
import { clearHealthData, importHealthExport } from "@/actions/health";
import type { HealthImportRow } from "@/lib/data/health";
import { formatDate, formatTimestamp } from "@/lib/dates";

/** Import a NOOP export (the offline strap companion app) as a bridge from a Mac or Android, see what is stored, and clear it. */
export function DataView({ imports, dayCount, workoutCount, sleepCount }: { imports: HealthImportRow[]; dayCount: number; workoutCount: number; sleepCount: number }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [chosen, setChosen] = React.useState<File[]>([]);

  function submit() {
    if (!chosen.length) return;
    const fd = new FormData();
    for (const f of chosen) fd.append("files", f, f.name);
    startTransition(async () => {
      const res = await importHealthExport(fd);
      if (res.ok) {
        const s = res.data;
        toast.success(`Imported ${s.days} days, ${s.sleeps} sleeps, ${s.workouts} workouts${s.journal ? `, ${s.journal} journal entries` : ""}.`);
        setChosen([]);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function clearAll() {
    if (!window.confirm("Remove every imported health row? You can import the export again later.")) return;
    startTransition(async () => {
      const res = await clearHealthData();
      if (res.ok) {
        toast.success("Health data cleared.");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="health-import">
        <SectionHeader index="01" title={<span id="health-import">Import an export</span>} />
        <div className="mt-3 flex flex-col gap-4">
          <div className="border-line-1 bg-surface-1 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={inputRef} type="file" multiple accept=".zip,.csv,application/zip,text/csv" className="sr-only" id="health-files" onChange={(e) => setChosen(Array.from(e.target.files ?? []))} />
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
                <Upload /> Choose files
              </Button>
              <Button type="button" size="sm" loading={pending} disabled={pending || !chosen.length} onClick={submit}>
                {pending ? "Importing…" : "Import"}
              </Button>
              <span className="text-text-3 text-xs">{chosen.length ? chosen.map((f) => f.name).join(", ") : "The export zip, or its CSV files."}</span>
            </div>
            <ul className="text-text-2 mt-4 flex flex-col gap-1.5 text-sm">
              <li>
                <span className="text-text-1 font-medium">Strap:</span> the primary source is the Strap tab, which reads the strap directly over Bluetooth. Exports are a bridge for history collected elsewhere.
              </li>
              <li>
                <span className="text-text-1 font-medium">NOOP:</span> Settings, Backup and restore, Export CSV. NOOP writes the same layout, so the zip imports as is. A .noopbak file is a raw database and is not supported here.
              </li>
              <li>Re-importing is safe: days and sessions are matched on their date and start time, so a newer export only adds what is new.</li>
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="health-stored">
        <SectionHeader index="02" title={<span id="health-stored">What is stored</span>} action={dayCount || imports.length ? <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={clearAll}><Trash2 /> Clear all</Button> : undefined} />
        <MetricStrip cols={3} className="mt-3">
          <Metric label="Days" value={String(dayCount)} muted={!dayCount} />
          <Metric label="Sleeps" value={String(sleepCount)} muted={!sleepCount} />
          <Metric label="Workouts" value={String(workoutCount)} muted={!workoutCount} />
        </MetricStrip>
      </section>

      <section aria-labelledby="health-history">
        <SectionHeader index="03" title={<span id="health-history">Imports</span>} count={imports.length} />
        {imports.length ? (
          <RowList className="mt-2">
            {imports.map((i) => (
              <HealthRow key={i.id} title={i.filename} meta={`${formatTimestamp(i.created_at)} · ${i.source === "noop" ? "NOOP export" : "CSV export"}${i.first_day && i.last_day ? ` · ${formatDate(i.first_day, "short")} to ${formatDate(i.last_day, "short")}` : ""}`} value={`${i.days} days · ${i.workouts} workouts`} />
            ))}
          </RowList>
        ) : (
          <EmptyState className="mt-3" title="Nothing imported yet" description="Your first import is listed here with what it added." />
        )}
      </section>
    </div>
  );
}
