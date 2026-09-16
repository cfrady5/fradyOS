import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, formatDate, dueLabel } from "@/lib/dates";
import type { Profile } from "@/lib/types";

type Candidate = {
  kind: string;
  title: string;
  body: string | null;
  href: string;
  entity_type: string;
  entity_id: string;
  dedupe_key: string;
  due_date: string | null;
};

/**
 * Computes reminder candidates from live records and inserts only the ones
 * not already present (unique on user_id + dedupe_key). Returns the number created.
 * Safe to call from the app (throttled) and from the scheduled job.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateNotificationsForUser(supabase: SupabaseClient<any, any, any>, userId: string, profile: Pick<Profile, "reminder_days_before_due" | "reminder_days_before_social" | "reminder_days_before_event">, today: string): Promise<number> {
  const dueHorizon = addDays(today, profile.reminder_days_before_due);
  const socialHorizon = addDays(today, profile.reminder_days_before_social);
  const eventHorizon = addDays(today, profile.reminder_days_before_event);
  const candidates: Candidate[] = [];

  // Tasks: overdue + due soon (excluding waiting tasks handled below)
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id,title,status,due_date,waiting_person,waiting_followup_date,waiting_expected_date")
    .eq("user_id", userId)
    .neq("status", "completed");
  for (const t of (tasks ?? []) as { id: string; title: string; status: string; due_date: string | null; waiting_person: string | null; waiting_followup_date: string | null; waiting_expected_date: string | null }[]) {
    if (t.status === "waiting") {
      if (t.waiting_followup_date && t.waiting_followup_date <= today) {
        candidates.push({
          kind: "followup_due",
          title: `Follow up with ${t.waiting_person ?? "someone"}`,
          body: t.title,
          href: `/waiting?task=${t.id}`,
          entity_type: "task",
          entity_id: t.id,
          dedupe_key: `task:${t.id}:followup:${t.waiting_followup_date}`,
          due_date: t.waiting_followup_date,
        });
      }
      if (t.waiting_expected_date && t.waiting_expected_date < today) {
        candidates.push({
          kind: "delivery_overdue",
          title: `${t.waiting_person ?? "Someone"} is late: ${t.title}`,
          body: `Expected ${formatDate(t.waiting_expected_date, "medium", today)}`,
          href: `/waiting?task=${t.id}`,
          entity_type: "task",
          entity_id: t.id,
          dedupe_key: `task:${t.id}:delivery_overdue:${t.waiting_expected_date}`,
          due_date: t.waiting_expected_date,
        });
      }
      continue;
    }
    if (!t.due_date) continue;
    if (t.due_date < today) {
      candidates.push({
        kind: "task_overdue",
        title: `Overdue: ${t.title}`,
        body: dueLabel(t.due_date, today),
        href: `/tasks?task=${t.id}`,
        entity_type: "task",
        entity_id: t.id,
        dedupe_key: `task:${t.id}:overdue:${t.due_date}`,
        due_date: t.due_date,
      });
    } else if (t.due_date <= dueHorizon) {
      candidates.push({
        kind: "task_due_soon",
        title: `${dueLabel(t.due_date, today)}: ${t.title}`,
        body: null,
        href: `/tasks?task=${t.id}`,
        entity_type: "task",
        entity_id: t.id,
        dedupe_key: `task:${t.id}:due_soon:${t.due_date}`,
        due_date: t.due_date,
      });
    }
  }

  // Social posts: draft / approval / publish milestones
  const { data: posts } = await supabase
    .from("social_posts")
    .select("id,title,status,draft_due_date,approval_due_date,publish_date,followup_date,approver")
    .eq("user_id", userId)
    .neq("status", "published");
  for (const p of (posts ?? []) as { id: string; title: string; status: string; draft_due_date: string | null; approval_due_date: string | null; publish_date: string | null; followup_date: string | null; approver: string | null }[]) {
    const milestones: { key: string; date: string | null; label: string; active: boolean }[] = [
      { key: "draft", date: p.draft_due_date, label: "Draft due", active: ["idea", "drafting"].includes(p.status) },
      { key: "approval", date: p.approval_due_date, label: "Approval due", active: ["idea", "drafting", "awaiting_approval"].includes(p.status) },
      { key: "publish", date: p.publish_date, label: "Publish", active: true },
    ];
    for (const m of milestones) {
      if (!m.date || !m.active) continue;
      if (m.date < today) {
        candidates.push({
          kind: "social_overdue",
          title: `${m.label} overdue: ${p.title}`,
          body: dueLabel(m.date, today),
          href: `/calendar?post=${p.id}`,
          entity_type: "social_post",
          entity_id: p.id,
          dedupe_key: `social:${p.id}:${m.key}:overdue:${m.date}`,
          due_date: m.date,
        });
      } else if (m.date <= socialHorizon) {
        candidates.push({
          kind: "social_due_soon",
          title: `${m.label} ${dueLabel(m.date, today).toLowerCase().replace("due ", "")}: ${p.title}`,
          body: null,
          href: `/calendar?post=${p.id}`,
          entity_type: "social_post",
          entity_id: p.id,
          dedupe_key: `social:${p.id}:${m.key}:soon:${m.date}`,
          due_date: m.date,
        });
      }
    }
    if (p.followup_date && p.followup_date <= today && p.status === "awaiting_approval") {
      candidates.push({
        kind: "approval_followup",
        title: `Follow up with ${p.approver ?? "approver"} on ${p.title}`,
        body: null,
        href: `/calendar?post=${p.id}`,
        entity_type: "social_post",
        entity_id: p.id,
        dedupe_key: `social:${p.id}:followup:${p.followup_date}`,
        due_date: p.followup_date,
      });
    }
  }

  // Events: upcoming within horizon, and flagged for review
  const { data: events } = await supabase
    .from("events")
    .select("id,name,start_date,sync_flag,review_dismissed_at,dates_changed_at")
    .eq("user_id", userId)
    .eq("is_archived", false);
  for (const e of (events ?? []) as { id: string; name: string; start_date: string | null; sync_flag: string; review_dismissed_at: string | null; dates_changed_at: string | null }[]) {
    if (e.start_date && e.start_date >= today && e.start_date <= eventHorizon) {
      candidates.push({
        kind: "event_upcoming",
        title: `Event ${formatDate(e.start_date, "weekday", today)}: ${e.name}`,
        body: "Review preparation tasks and social plan",
        href: `/events/${e.id}`,
        entity_type: "event",
        entity_id: e.id,
        dedupe_key: `event:${e.id}:upcoming:${e.start_date}`,
        due_date: e.start_date,
      });
    }
    if (e.sync_flag !== "none" && !e.review_dismissed_at) {
      candidates.push({
        kind: "event_review",
        title: `${e.sync_flag === "removed" ? "Removed from Monday" : "Canceled"}: ${e.name}`,
        body: "Review what to do with local preparation work",
        href: `/events/${e.id}`,
        entity_type: "event",
        entity_id: e.id,
        dedupe_key: `event:${e.id}:flag:${e.sync_flag}`,
        due_date: e.start_date,
      });
    }
  }

  if (candidates.length === 0) return 0;

  // Skip keys that already exist (read or unread) so nothing repeats.
  const keys = candidates.map((c) => c.dedupe_key);
  const { data: existing } = await supabase.from("notifications").select("dedupe_key").eq("user_id", userId).in("dedupe_key", keys);
  const have = new Set(((existing ?? []) as { dedupe_key: string }[]).map((x) => x.dedupe_key));
  const fresh = candidates.filter((c) => !have.has(c.dedupe_key)).map((c) => ({ user_id: userId, ...c }));
  if (fresh.length === 0) return 0;
  const { error } = await supabase.from("notifications").upsert(fresh, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  if (error) {
    console.error("notification insert failed", error.message);
    return 0;
  }
  return fresh.length;
}
