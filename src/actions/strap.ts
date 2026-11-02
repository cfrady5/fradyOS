"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { isMissingTable } from "@/lib/data/health";
import { deriveAndStore, upsertMinutes } from "@/lib/strap/ingest";
import type { StrapMinute } from "@/lib/strap/derive/types";

const NOT_SET_UP = "Strap tables are missing. Run supabase/migrations/0014_strap.sql in the Supabase SQL editor, then try again.";

const deviceSchema = z.object({
  serial: z.string().trim().min(1).max(40),
  name: z.string().trim().max(80).nullable().optional(),
  model: z.enum(["auto", "whoop4", "whoop5"]).default("auto"),
  firmware: z.string().trim().max(80).nullable().optional(),
  batteryPct: z.number().min(0).max(100).nullable().optional(),
  maxHr: z.number().int().min(100).max(230).nullable().optional(),
});

export async function registerStrapDevice(input: z.input<typeof deviceSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = deviceSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid device.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const d = parsed.data;
    const { data, error } = await supabase
      .from("strap_devices")
      .upsert({ user_id: ws.userId, serial: d.serial, name: d.name ?? null, model: d.model, firmware: d.firmware ?? null, battery_pct: d.batteryPct ?? null, max_hr: d.maxHr ?? null, last_seen_at: new Date().toISOString() }, { onConflict: "user_id,serial" })
      .select("id")
      .single();
    if (error) return fail(isMissingTable(error) ? NOT_SET_UP : error.message);
    revalidatePath("/health/strap");
    return ok({ id: String((data as { id: string }).id) });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function setStrapMaxHr(serial: string, maxHr: number | null): Promise<ActionResult<undefined>> {
  const parsed = z.object({ serial: z.string().min(1).max(40), maxHr: z.number().int().min(100).max(230).nullable() }).safeParse({ serial, maxHr });
  if (!parsed.success) return fail("Max heart rate must be between 100 and 230.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("strap_devices").update({ max_hr: parsed.data.maxHr }).eq("user_id", ws.userId).eq("serial", parsed.data.serial);
    if (error) return fail(error.message);
    revalidatePath("/health/strap");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function startStrapOffload(input: { serial: string | null; platform: "ios" | "android" | "web"; mode?: "offload" | "link" }): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data, error } = await supabase.from("strap_offloads").insert({ user_id: ws.userId, serial: input.serial, platform: input.platform, status: "running", log: input.mode === "link" ? ["live link"] : null }).select("id").single();
    if (error) return fail(isMissingTable(error) ? NOT_SET_UP : error.message);
    return ok({ id: String((data as { id: string }).id) });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const minuteSchema = z.object({
  minute: z.iso.datetime(),
  hrAvg: z.number().min(0).max(300).nullable(),
  hrMin: z.number().int().min(0).max(300).nullable(),
  hrMax: z.number().int().min(0).max(300).nullable(),
  rr: z.array(z.number().int().min(0).max(5000)).max(200),
  motion: z.number().min(0).max(100).nullable(),
  skinContact: z.number().min(0).max(1).nullable(),
  rawSkinTemp: z.number().nullable(),
  rawSpo2: z.object({ red: z.number(), ir: z.number() }).nullable(),
  rawResp: z.number().nullable(),
  samples: z.number().int().min(0).max(10000),
});

/** Store a batch of minute aggregates mid-offload. The client calls this per chunk so progress survives a disconnect. */
export async function ingestStrapMinutes(input: { offloadId: string | null; minutes: StrapMinute[]; records: number; chunks: number }): Promise<ActionResult<{ stored: number }>> {
  const parsed = z.object({ offloadId: z.string().uuid().nullable(), minutes: z.array(minuteSchema).max(3000), records: z.number().int().min(0), chunks: z.number().int().min(0) }).safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid batch.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { minutes, offloadId, records, chunks } = parsed.data;
    await upsertMinutes(supabase, ws.userId, minutes);
    if (!offloadId) return ok({ stored: minutes.length });
    const first = minutes.length ? minutes.reduce((a, b) => (a.minute < b.minute ? a : b)).minute : null;
    const last = minutes.length ? minutes.reduce((a, b) => (a.minute > b.minute ? a : b)).minute : null;
    const { data: existing } = await supabase.from("strap_offloads").select("minutes,first_sample_at,last_sample_at").eq("id", offloadId).eq("user_id", ws.userId).maybeSingle();
    const prev = (existing ?? {}) as { minutes?: number; first_sample_at?: string | null; last_sample_at?: string | null };
    await supabase
      .from("strap_offloads")
      .update({
        records,
        chunks,
        minutes: (prev.minutes ?? 0) + minutes.length,
        first_sample_at: [prev.first_sample_at, first].filter(Boolean).sort()[0] ?? null,
        last_sample_at: [prev.last_sample_at, last].filter(Boolean).sort().at(-1) ?? null,
      })
      .eq("id", offloadId)
      .eq("user_id", ws.userId);
    return ok({ stored: minutes.length });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Close the offload, derive sleep, heart, strain and workouts for the touched days, and recompute the intelligence layer. */
export async function finishStrapOffload(input: { offloadId: string; status: "succeeded" | "failed" | "aborted"; error?: string | null; log?: string[]; serial?: string | null; batteryPct?: number | null; firmware?: string | null }): Promise<ActionResult<{ days: number; sleeps: number; workouts: number; notes: string[] }>> {
  const parsed = z
    .object({ offloadId: z.string().uuid(), status: z.enum(["succeeded", "failed", "aborted"]), error: z.string().max(1000).nullable().optional(), log: z.array(z.string().max(300)).max(400).optional(), serial: z.string().max(40).nullable().optional(), batteryPct: z.number().min(0).max(100).nullable().optional(), firmware: z.string().max(80).nullable().optional() })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const p = parsed.data;
    const { data: off, error } = await supabase.from("strap_offloads").update({ status: p.status, error: p.error ?? null, log: p.log ?? null, finished_at: new Date().toISOString() }).eq("id", p.offloadId).eq("user_id", ws.userId).select("first_sample_at,last_sample_at,minutes").single();
    if (error) return fail(error.message);
    if (p.serial) {
      await supabase.from("strap_devices").update({ last_offload_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), ...(p.batteryPct != null ? { battery_pct: p.batteryPct } : {}), ...(p.firmware ? { firmware: p.firmware } : {}) }).eq("user_id", ws.userId).eq("serial", p.serial);
    }
    const o = off as { first_sample_at: string | null; last_sample_at: string | null; minutes: number };
    if (!o.minutes || !o.first_sample_at || !o.last_sample_at) {
      revalidatePath("/", "layout");
      return ok({ days: 0, sleeps: 0, workouts: 0, notes: ["No samples arrived in this offload."] });
    }
    const { data: dev } = await supabase.from("strap_devices").select("max_hr").eq("user_id", ws.userId).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
    const maxHr = (dev as { max_hr: number | null } | null)?.max_hr ?? null;
    const out = await deriveAndStore(supabase, ws.userId, { fromDay: o.first_sample_at.slice(0, 10), toDay: o.last_sample_at.slice(0, 10), today: ws.today, timezone: ws.timezone, maxHr });
    revalidatePath("/", "layout");
    return ok({ days: out.days, sleeps: out.sleeps, workouts: out.workouts, notes: out.notes });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Live link: derive the days touched since `sinceIso` and recompute the intelligence layer. Cheap enough to run every cycle. */
export async function deriveStrapRecent(input: { sinceIso: string }): Promise<ActionResult<{ days: number }>> {
  const parsed = z.object({ sinceIso: z.iso.datetime() }).safeParse(input);
  if (!parsed.success) return fail("Invalid window.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: dev } = await supabase.from("strap_devices").select("max_hr").eq("user_id", ws.userId).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
    const fromDay = new Date(Date.parse(parsed.data.sinceIso) - 86_400_000).toISOString().slice(0, 10);
    const out = await deriveAndStore(supabase, ws.userId, { fromDay, toDay: ws.today, today: ws.today, timezone: ws.timezone, maxHr: (dev as { max_hr: number | null } | null)?.max_hr ?? null });
    revalidatePath("/", "layout");
    return ok({ days: out.days });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Re-derive every stored minute (after an algorithm change). */
export async function rederiveStrap(): Promise<ActionResult<{ days: number }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: first } = await supabase.from("strap_minutes").select("minute").eq("user_id", ws.userId).order("minute", { ascending: true }).limit(1).maybeSingle();
    if (!first) return fail("No strap data stored yet.");
    const { data: dev } = await supabase.from("strap_devices").select("max_hr").eq("user_id", ws.userId).limit(1).maybeSingle();
    const out = await deriveAndStore(supabase, ws.userId, { fromDay: String((first as { minute: string }).minute).slice(0, 10), toDay: ws.today, today: ws.today, timezone: ws.timezone, maxHr: (dev as { max_hr: number | null } | null)?.max_hr ?? null });
    revalidatePath("/", "layout");
    return ok({ days: out.days });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function clearStrapData(): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    for (const t of ["strap_minutes", "strap_offloads"]) {
      const { error } = await supabase.from(t).delete().eq("user_id", ws.userId);
      if (error) return fail(error.message);
    }
    for (const t of ["health_days", "health_sleeps", "health_workouts"]) await supabase.from(t).delete().eq("user_id", ws.userId).like("source", "ble%");
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
