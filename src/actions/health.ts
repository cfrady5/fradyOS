"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { parseWhoopExport } from "@/lib/health/whoopImport";
import { z } from "zod";
import { sessionStats, type LiveSample } from "@/lib/ble/heartRate";
import { isMissingTable } from "@/lib/data/health";

const MAX_FILES = 8;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const CHUNK = 400;

function revalidate() {
  revalidatePath("/", "layout");
}

export interface ImportSummary {
  days: number;
  sleeps: number;
  workouts: number;
  journal: number;
  files: string[];
  source: "whoop" | "noop";
  firstDay: string | null;
  lastDay: string | null;
}

/**
 * Import a WHOOP data export (zip or its CSVs) or NOOP's CSV export. Rows are upserted by day or
 * session start, so importing the same export twice changes nothing and a newer export fills in
 * the days since the last one.
 */
export async function importHealthExport(formData: FormData): Promise<ActionResult<ImportSummary>> {
  try {
    const ws = await requireWorkspace();
    const entries = formData.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
    if (!entries.length) return fail("Choose the export zip or its CSV files first.");
    if (entries.length > MAX_FILES) return fail(`Up to ${MAX_FILES} files at a time.`);
    const total = entries.reduce((s, f) => s + f.size, 0);
    if (total > MAX_TOTAL_BYTES) return fail("That is over 30 MB. Import the zip rather than the loose CSVs, or split it.");
    const files = await Promise.all(entries.map(async (f) => ({ name: f.name, data: Buffer.from(await f.arrayBuffer()) })));

    let parsed: ReturnType<typeof parseWhoopExport>;
    try {
      parsed = parseWhoopExport(files);
    } catch (e) {
      return fail(`Could not read the export: ${errorMessage(e)}`);
    }
    if (!parsed.files.length) return fail("No WHOOP files found. Expected physiological_cycles.csv, sleeps.csv, workouts.csv or journal_entries.csv, loose or inside the export zip.");
    if (!parsed.days.length && !parsed.sleeps.length && !parsed.workouts.length && !parsed.journal.length) return fail("The files were recognised but held no rows.");

    const supabase = await createClient();
    const uid = ws.userId;
    const upsert = async (table: string, rows: Record<string, unknown>[], onConflict: string) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase.from(table).upsert(rows.slice(i, i + CHUNK).map((r) => ({ user_id: uid, ...r })), { onConflict });
        if (error) throw new Error(`${table}: ${error.message}`);
      }
    };
    await upsert("health_days", parsed.days as unknown as Record<string, unknown>[], "user_id,day");
    await upsert("health_sleeps", parsed.sleeps as unknown as Record<string, unknown>[], "user_id,start_at");
    await upsert("health_workouts", parsed.workouts as unknown as Record<string, unknown>[], "user_id,start_at,activity");
    await upsert("health_journal", parsed.journal as unknown as Record<string, unknown>[], "user_id,day,question");

    const dayKeys = [...parsed.days.map((d) => d.day), ...parsed.sleeps.map((s) => s.day), ...parsed.workouts.map((w) => w.day)].sort();
    const summary: ImportSummary = {
      days: parsed.days.length,
      sleeps: parsed.sleeps.length,
      workouts: parsed.workouts.length,
      journal: parsed.journal.length,
      files: parsed.files,
      source: parsed.source,
      firstDay: dayKeys[0] ?? null,
      lastDay: dayKeys[dayKeys.length - 1] ?? null,
    };
    const { error } = await supabase.from("health_imports").insert({
      user_id: uid,
      filename: entries.map((f) => f.name).join(", ").slice(0, 200),
      source: summary.source,
      days: summary.days,
      sleeps: summary.sleeps,
      workouts: summary.workouts,
      journal: summary.journal,
      first_day: summary.firstDay,
      last_day: summary.lastDay,
    });
    if (error) return fail(error.message);
    revalidate();
    return ok(summary);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Remove every imported health row for the signed-in user. */
export async function clearHealthData(): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    for (const table of ["health_journal", "health_workouts", "health_sleeps", "health_days", "health_imports"]) {
      const { error } = await supabase.from(table).delete().eq("user_id", ws.userId);
      if (error) return fail(`${table}: ${error.message}`);
    }
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const MAX_LIVE_SAMPLES = 12 * 60 * 60; // twelve hours at one reading per second
const MAX_RR_PER_SAMPLE = 32;

const liveSessionSchema = z.object({
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  deviceName: z.string().trim().max(80).nullable(),
  samples: z
    .array(z.tuple([z.number().int().min(0).max(MAX_LIVE_SAMPLES * 2), z.number().int().min(0).max(300)], z.array(z.number().int().min(0).max(5000)).max(MAX_RR_PER_SAMPLE)))
    .min(1)
    .max(MAX_LIVE_SAMPLES),
});

export interface LiveSessionInput {
  startAt: string;
  endAt: string;
  deviceName: string | null;
  samples: LiveSample[];
}

/** Store a live Bluetooth session. Stats are recomputed here so the row never trusts client maths. */
export async function saveLiveSession(input: LiveSessionInput): Promise<ActionResult<{ id: string }>> {
  const parsed = liveSessionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid session.");
  const { startAt, endAt, deviceName } = parsed.data;
  if (Date.parse(endAt) < Date.parse(startAt)) return fail("The session ends before it starts.");
  const samples: LiveSample[] = parsed.data.samples.map(([t, bpm, ...rest]) => (rest[0]?.length ? [t, bpm, rest[0]] : [t, bpm]));
  const stats = sessionStats(samples);
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("health_live_sessions")
      .insert({
        user_id: ws.userId,
        start_at: startAt,
        end_at: endAt,
        device_name: deviceName || null,
        sample_count: stats.sampleCount,
        avg_hr: stats.avgHr,
        max_hr: stats.maxHr,
        min_hr: stats.minHr,
        rmssd_ms: stats.rmssdMs,
        samples,
      })
      .select("id")
      .single();
    if (error) {
      if (isMissingTable(error)) return fail("Live sessions are not set up yet. Run supabase/migrations/0012_health_live.sql, then save again.");
      return fail(error.message);
    }
    revalidate();
    return ok({ id: String((data as { id: string }).id) });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteLiveSession(id: string): Promise<ActionResult<undefined>> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return fail("Invalid session.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("health_live_sessions").delete().eq("user_id", ws.userId).eq("id", parsed.data);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
