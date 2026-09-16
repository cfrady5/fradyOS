import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Event, SocialPost, Task } from "@/lib/types";

import type { CalendarItem } from "@/lib/calendar-kinds";
export type { CalendarItem, CalendarItemKind } from "@/lib/calendar-kinds";

export async function getCalendarItems(userId: string, from: string, to: string): Promise<CalendarItem[]> {
  const supabase = await createClient();
  const [events, tasks, posts] = await Promise.all([
    supabase.from("events").select("*").eq("user_id", userId).eq("is_archived", false).not("start_date", "is", null).lte("start_date", to).or(`end_date.gte.${from},and(end_date.is.null,start_date.gte.${from})`),
    supabase
      .from("tasks")
      .select("id,title,status,due_date,due_time,planned_date,waiting_person,waiting_followup_date,waiting_expected_date,completed_at,project:projects(name)")
      .eq("user_id", userId)
      .or(`and(due_date.gte.${from},due_date.lte.${to}),and(planned_date.gte.${from},planned_date.lte.${to}),and(waiting_followup_date.gte.${from},waiting_followup_date.lte.${to}),and(waiting_expected_date.gte.${from},waiting_expected_date.lte.${to})`),
    supabase
      .from("social_posts")
      .select("id,title,status,platform,brand,publish_date,publish_time,draft_due_date,approval_due_date")
      .eq("user_id", userId)
      .or(`and(publish_date.gte.${from},publish_date.lte.${to}),and(draft_due_date.gte.${from},draft_due_date.lte.${to}),and(approval_due_date.gte.${from},approval_due_date.lte.${to})`),
  ]);
  if (events.error) throw new Error(events.error.message);
  if (tasks.error) throw new Error(tasks.error.message);
  if (posts.error) throw new Error(posts.error.message);

  const items: CalendarItem[] = [];
  for (const e of (events.data ?? []) as Event[]) {
    items.push({ id: `event:${e.id}`, entityId: e.id, entityType: "event", kind: "event", date: e.start_date!, endDate: e.end_date, time: e.start_time, title: e.name, subtitle: e.location, readOnly: e.source === "monday", done: e.sync_flag !== "none" });
  }
  type T = Pick<Task, "id" | "title" | "status" | "due_date" | "due_time" | "planned_date" | "waiting_person" | "waiting_followup_date" | "waiting_expected_date" | "completed_at"> & { project: { name: string } | null };
  for (const t of (tasks.data ?? []) as unknown as T[]) {
    const done = t.status === "completed";
    if (t.due_date && t.due_date >= from && t.due_date <= to) items.push({ id: `due:${t.id}`, entityId: t.id, entityType: "task", kind: "due", date: t.due_date, time: t.due_time, title: t.title, subtitle: t.project?.name, done });
    if (t.planned_date && t.planned_date >= from && t.planned_date <= to && t.planned_date !== t.due_date) items.push({ id: `planned:${t.id}`, entityId: t.id, entityType: "task", kind: "planned", date: t.planned_date, title: t.title, subtitle: t.project?.name, done });
    if (t.status === "waiting") {
      if (t.waiting_followup_date && t.waiting_followup_date >= from && t.waiting_followup_date <= to) items.push({ id: `followup:${t.id}`, entityId: t.id, entityType: "task", kind: "followup", date: t.waiting_followup_date, title: `Follow up: ${t.waiting_person ?? "someone"}`, subtitle: t.title });
      if (t.waiting_expected_date && t.waiting_expected_date >= from && t.waiting_expected_date <= to) items.push({ id: `delivery:${t.id}`, entityId: t.id, entityType: "task", kind: "delivery", date: t.waiting_expected_date, title: `${t.waiting_person ?? "Someone"} delivers`, subtitle: t.title });
    }
  }
  type P = Pick<SocialPost, "id" | "title" | "status" | "platform" | "brand" | "publish_date" | "publish_time" | "draft_due_date" | "approval_due_date">;
  for (const p of (posts.data ?? []) as P[]) {
    const done = p.status === "published";
    const sub = [p.platform, p.brand].filter(Boolean).join(" · ") || null;
    if (p.publish_date && p.publish_date >= from && p.publish_date <= to) items.push({ id: `social_publish:${p.id}`, entityId: p.id, entityType: "social", kind: "social_publish", date: p.publish_date, time: p.publish_time, title: p.title, subtitle: sub, done });
    if (!done && p.draft_due_date && p.draft_due_date >= from && p.draft_due_date <= to && ["idea", "drafting"].includes(p.status)) items.push({ id: `social_draft:${p.id}`, entityId: p.id, entityType: "social", kind: "social_draft", date: p.draft_due_date, title: `Draft: ${p.title}`, subtitle: sub });
    if (!done && p.approval_due_date && p.approval_due_date >= from && p.approval_due_date <= to && ["idea", "drafting", "awaiting_approval"].includes(p.status)) items.push({ id: `social_approval:${p.id}`, entityId: p.id, entityType: "social", kind: "social_approval", date: p.approval_due_date, title: `Approval: ${p.title}`, subtitle: sub });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time ?? "99") < (b.time ?? "99") ? -1 : 0));
  return items;
}
