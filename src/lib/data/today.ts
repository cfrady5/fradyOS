import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/dates";
import type { Event, SocialPostWithRefs, TaskWithRefs } from "@/lib/types";
import { shapeTask, TASK_SELECT } from "./tasks";
import { SOCIAL_SELECT, shapePost } from "./social";

export type TodayData = {
  focus: TaskWithRefs[];
  overdue: TaskWithRefs[];
  dueToday: TaskWithRefs[];
  plannedToday: TaskWithRefs[];
  dueWeek: TaskWithRefs[];
  events: (Event & { prep_open: number; prep_total: number; social_open: number })[];
  socialSoon: SocialPostWithRefs[];
  followups: TaskWithRefs[];
  recentlyCompleted: TaskWithRefs[];
  counts: { inbox: number };
};

export async function getTodayData(userId: string, today: string): Promise<TodayData> {
  const supabase = await createClient();
  const weekEnd = addDays(today, 7);
  const eventHorizon = addDays(today, 30);
  const socialHorizon = addDays(today, 7);
  const recentSince = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [openRes, completedRes, eventsRes, socialRes] = await Promise.all([
    supabase.from("tasks").select(TASK_SELECT).eq("user_id", userId).neq("status", "completed"),
    supabase.from("tasks").select(TASK_SELECT).eq("user_id", userId).eq("status", "completed").gte("completed_at", recentSince).order("completed_at", { ascending: false }).limit(12),
    supabase.from("events").select("*").eq("user_id", userId).eq("is_archived", false).lte("start_date", eventHorizon).or(`start_date.gte.${today},end_date.gte.${today}`).order("start_date"),
    supabase.from("social_posts").select(SOCIAL_SELECT).eq("user_id", userId).neq("status", "published"),
  ]);
  if (openRes.error) throw new Error(openRes.error.message);

  const open = ((openRes.data ?? []) as Parameters<typeof shapeTask>[0][]).map(shapeTask);
  const byDue = (a: TaskWithRefs, b: TaskWithRefs) => (a.due_date ?? "9999") < (b.due_date ?? "9999") ? -1 : (a.due_date ?? "9999") > (b.due_date ?? "9999") ? 1 : prioRank(b.priority) - prioRank(a.priority);

  const focus = open.filter((t) => t.focus_rank).sort((a, b) => (a.focus_rank ?? 0) - (b.focus_rank ?? 0));
  const nonWaiting = open.filter((t) => t.status !== "waiting");
  const overdue = nonWaiting.filter((t) => t.due_date && t.due_date < today).sort(byDue);
  const dueToday = nonWaiting.filter((t) => t.due_date === today).sort((a, b) => prioRank(b.priority) - prioRank(a.priority));
  const plannedToday = nonWaiting.filter((t) => t.planned_date === today && t.due_date !== today).sort((a, b) => prioRank(b.priority) - prioRank(a.priority));
  const dueWeek = nonWaiting.filter((t) => t.due_date && t.due_date > today && t.due_date <= weekEnd).sort(byDue);
  const waiting = open.filter((t) => t.status === "waiting");
  const followups = waiting
    .filter((t) => (t.waiting_followup_date && t.waiting_followup_date <= today) || (t.waiting_expected_date && t.waiting_expected_date < today))
    .sort((a, b) => (a.waiting_followup_date ?? a.waiting_expected_date ?? "") < (b.waiting_followup_date ?? b.waiting_expected_date ?? "") ? -1 : 1);

  const events = ((eventsRes.data ?? []) as Event[]).filter((e) => e.sync_flag === "none" || e.review_dismissed_at === null);
  const eventIds = events.map((e) => e.id);
  const prep = open.filter((t) => t.event_id && eventIds.includes(t.event_id));
  const allEventTasks = eventIds.length
    ? ((await supabase.from("tasks").select("id,event_id,status").eq("user_id", userId).in("event_id", eventIds)).data ?? []) as { id: string; event_id: string; status: string }[]
    : [];
  const posts = ((socialRes.data ?? []) as SocialPostWithRefs[]).map(shapePost);

  const eventsWithCounts = events.map((e) => ({
    ...e,
    prep_open: prep.filter((t) => t.event_id === e.id).length,
    prep_total: allEventTasks.filter((t) => t.event_id === e.id).length,
    social_open: posts.filter((p) => p.event_id === e.id).length,
  }));

  const socialSoon = posts
    .map((p) => ({ p, next: nextMilestoneDate(p) }))
    .filter((x) => x.next && x.next <= socialHorizon)
    .sort((a, b) => (a.next! < b.next! ? -1 : 1))
    .map((x) => x.p);

  return {
    focus,
    overdue,
    dueToday,
    plannedToday,
    dueWeek,
    events: eventsWithCounts,
    socialSoon,
    followups,
    recentlyCompleted: ((completedRes.data ?? []) as Parameters<typeof shapeTask>[0][]).map(shapeTask),
    counts: { inbox: open.filter((t) => t.status === "inbox").length },
  };
}

function prioRank(p: string) {
  return p === "urgent" ? 3 : p === "high" ? 2 : p === "normal" ? 1 : 0;
}

function nextMilestoneDate(p: SocialPostWithRefs): string | null {
  const ms: (string | null)[] = [];
  if (["idea", "drafting"].includes(p.status)) ms.push(p.draft_due_date);
  if (["idea", "drafting", "awaiting_approval"].includes(p.status)) ms.push(p.approval_due_date);
  ms.push(p.publish_date);
  const xs = ms.filter((d): d is string => Boolean(d)).sort();
  return xs[0] ?? null;
}
