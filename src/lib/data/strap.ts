import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/data/health";

export interface StrapDevice {
  id: string;
  serial: string;
  name: string | null;
  model: "auto" | "whoop4" | "whoop5";
  firmware: string | null;
  battery_pct: number | null;
  max_hr: number | null;
  last_seen_at: string | null;
  last_offload_at: string | null;
}

export interface StrapOffload {
  id: string;
  serial: string | null;
  platform: string | null;
  started_at: string;
  finished_at: string | null;
  status: "running" | "succeeded" | "failed" | "aborted";
  records: number;
  chunks: number;
  minutes: number;
  first_sample_at: string | null;
  last_sample_at: string | null;
  error: string | null;
  log: string[] | null;
}

export interface StrapData {
  notReady: boolean;
  devices: StrapDevice[];
  offloads: StrapOffload[];
  /** Minutes of strap data stored per local day, last 7 days, oldest first. */
  coverage: { day: string; minutes: number }[];
  totalMinutes: number;
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const getStrapData = cache(async (userId: string, today: string, timezone: string): Promise<StrapData> => {
  const supabase = await createClient();
  const [devices, offloads, total] = await Promise.all([
    supabase.from("strap_devices").select("*").eq("user_id", userId).order("last_seen_at", { ascending: false, nullsFirst: false }),
    supabase.from("strap_offloads").select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(10),
    supabase.from("strap_minutes").select("minute", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  if ([devices, offloads, total].some((r) => r.error && isMissingTable(r.error))) return { notReady: true, devices: [], offloads: [], coverage: [], totalMinutes: 0 };
  for (const r of [devices, offloads]) if (r.error) throw new Error(r.error.message);

  const coverage: { day: string; minutes: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.parse(today) - i * 86_400_000).toISOString().slice(0, 10);
    const { from, to } = localDayBounds(day, timezone);
    const { count } = await supabase.from("strap_minutes").select("minute", { count: "exact", head: true }).eq("user_id", userId).gte("minute", from).lt("minute", to);
    coverage.push({ day, minutes: count ?? 0 });
  }

  return {
    notReady: false,
    devices: ((devices.data ?? []) as Record<string, unknown>[]).map((d) => ({ id: String(d.id), serial: String(d.serial), name: d.name ? String(d.name) : null, model: (d.model as StrapDevice["model"]) ?? "auto", firmware: d.firmware ? String(d.firmware) : null, battery_pct: num(d.battery_pct), max_hr: num(d.max_hr), last_seen_at: d.last_seen_at ? String(d.last_seen_at) : null, last_offload_at: d.last_offload_at ? String(d.last_offload_at) : null })),
    offloads: ((offloads.data ?? []) as Record<string, unknown>[]).map((o) => ({ id: String(o.id), serial: o.serial ? String(o.serial) : null, platform: o.platform ? String(o.platform) : null, started_at: String(o.started_at), finished_at: o.finished_at ? String(o.finished_at) : null, status: o.status as StrapOffload["status"], records: num(o.records) ?? 0, chunks: num(o.chunks) ?? 0, minutes: num(o.minutes) ?? 0, first_sample_at: o.first_sample_at ? String(o.first_sample_at) : null, last_sample_at: o.last_sample_at ? String(o.last_sample_at) : null, error: o.error ? String(o.error) : null, log: Array.isArray(o.log) ? (o.log as string[]) : null })),
    coverage,
    totalMinutes: total.count ?? 0,
  };
});

/** UTC instants bounding a local calendar day. */
export function localDayBounds(day: string, timeZone: string): { from: string; to: string } {
  const offsetAt = (iso: string) => {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute")) - d.getTime();
  };
  const guess = Date.parse(`${day}T00:00:00Z`);
  const from = new Date(guess - offsetAt(new Date(guess).toISOString()));
  const toGuess = guess + 86_400_000;
  const to = new Date(toGuess - offsetAt(new Date(toGuess).toISOString()));
  return { from: from.toISOString(), to: to.toISOString() };
}
