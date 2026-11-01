"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { runHealthIntelligence, type RunStats } from "@/lib/intel/pipeline";
import { isMissingTable } from "@/lib/data/health";
import { isWhoopConfigured } from "@/lib/whoop/client";
import { syncConnection, type WhoopConnection } from "@/lib/whoop/sync";

function revalidate() {
  revalidatePath("/", "layout");
}

const NOT_SET_UP = "Health Intelligence tables are missing. Run supabase/migrations/0013_biometrics.sql in the Supabase SQL editor, then try again.";

/** Re-run the whole intelligence layer for the signed-in user. */
export async function recomputeIntelligence(): Promise<ActionResult<RunStats>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const out = await runHealthIntelligence(supabase, ws.userId, { kind: "recompute", today: ws.today, timezone: ws.timezone });
    if (!out.ok) return fail(/could not find the table|does not exist/i.test(out.error) ? NOT_SET_UP : out.error);
    revalidate();
    return ok(out.stats);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const behaviorSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  kind: z.enum(["caffeine", "alcohol", "water", "meal", "calories", "protein", "exercise", "bedtime_routine", "supplement", "stress", "travel", "illness", "medication"]),
  amount: z.coerce.number().min(0).max(100000).optional().or(z.nan()),
  unit: z.string().trim().max(16).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Log a habit or event. Medication rows are private and never appear in insight text. */
export async function logBehavior(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const parsed = behaviorSchema.safeParse({
    day: formData.get("day"),
    time: formData.get("time") ?? "",
    kind: formData.get("kind"),
    amount: formData.get("amount") === "" || formData.get("amount") == null ? undefined : formData.get("amount"),
    unit: formData.get("unit") ?? undefined,
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid entry.");
  const { day, time, kind, amount, unit, note } = parsed.data;
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    let at: string | null = null;
    if (time) {
      const offset = tzOffsetIso(ws.timezone, `${day}T${time}:00`);
      at = new Date(`${day}T${time}:00${offset}`).toISOString();
    }
    const { data, error } = await supabase
      .from("health_behaviors")
      .insert({ user_id: ws.userId, day, at, kind, amount: amount == null || Number.isNaN(amount) ? null : amount, unit: unit || null, note: note || null, private: kind === "medication" })
      .select("id")
      .single();
    if (error) return fail(isMissingTable(error) ? NOT_SET_UP : error.message);
    revalidate();
    return ok({ id: String((data as { id: string }).id) });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** "+HH:MM" offset of a timezone at a local wall-clock instant. */
function tzOffsetIso(timeZone: string, localIso: string): string {
  const guess = new Date(`${localIso}Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  const offsetMin = Math.round((asUtc - guess.getTime()) / 60_000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export async function deleteBehavior(id: string): Promise<ActionResult<undefined>> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return fail("Invalid entry.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("health_behaviors").delete().eq("user_id", ws.userId).eq("id", parsed.data);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function setEventStatus(id: string, status: "open" | "dismissed"): Promise<ActionResult<undefined>> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return fail("Invalid event.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase
      .from("biometric_detected_events")
      .update({ status, dismissed_at: status === "dismissed" ? new Date().toISOString() : null })
      .eq("user_id", ws.userId)
      .eq("id", parsed.data);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

const prefSchema = z.object({
  in_app: z.boolean(),
  email: z.boolean(),
  min_severity: z.enum(["info", "low", "moderate", "high"]),
  z_moderate: z.number().min(1).max(4),
  persist_days: z.number().int().min(2).max(7),
});

export async function saveIntelPreferences(input: z.input<typeof prefSchema>): Promise<ActionResult<undefined>> {
  const parsed = prefSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid preferences.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("biometric_notification_preferences").upsert({ user_id: ws.userId, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) return fail(isMissingTable(error) ? NOT_SET_UP : error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function setRuleEnabled(ruleKey: string, enabled: boolean): Promise<ActionResult<undefined>> {
  const parsed = z.string().regex(/^[a-z]+\.[a-z0-9_]+$/).safeParse(ruleKey);
  if (!parsed.success) return fail("Invalid rule.");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("biometric_detection_rules").upsert({ user_id: ws.userId, rule_key: parsed.data, enabled, updated_at: new Date().toISOString() }, { onConflict: "user_id,rule_key" });
    if (error) return fail(isMissingTable(error) ? NOT_SET_UP : error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function disconnectWhoop(): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("whoop_connections").delete().eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function syncWhoopNow(): Promise<ActionResult<{ cycles: number; sleeps: number; workouts: number; recoveries: number }>> {
  try {
    const ws = await requireWorkspace();
    if (!isWhoopConfigured()) return fail("WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are not set.");
    if (!isAdminConfigured()) return fail("SUPABASE_SECRET_KEY is not set, so tokens cannot be read on the server.");
    const admin = createAdminClient();
    const { data } = await admin.from("whoop_connections").select("*").eq("user_id", ws.userId).maybeSingle();
    if (!data) return fail("WHOOP is not connected.");
    const counts = await syncConnection(admin, data as WhoopConnection, { timezone: ws.timezone, today: ws.today, trigger: "manual" });
    revalidate();
    return ok(counts);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
