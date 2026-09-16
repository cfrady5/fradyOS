import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Attachment, Event, EventTemplate, EventTemplateItem, MondayConnection, Note, SocialPostWithRefs, TaskWithRefs } from "@/lib/types";
import { shapeTask, TASK_SELECT } from "./tasks";
import { SOCIAL_SELECT, shapePost } from "./social";

export type EventListItem = Event & { work_area?: { id: string; name: string; color: string } | null; prep_open: number; prep_total: number; social_open: number };

export async function listEvents(userId: string, today: string, opts: { scope: "upcoming" | "past" | "review" | "all"; area?: string | null }): Promise<EventListItem[]> {
  const supabase = await createClient();
  let q = supabase.from("events").select("*, work_area:work_areas(id,name,color)").eq("user_id", userId).eq("is_archived", false);
  if (opts.area) q = q.eq("work_area_id", opts.area);
  if (opts.scope === "upcoming") q = q.or(`end_date.gte.${today},and(end_date.is.null,start_date.gte.${today}),start_date.is.null`).order("start_date", { ascending: true, nullsFirst: false });
  else if (opts.scope === "past") q = q.lt("start_date", today).order("start_date", { ascending: false });
  else if (opts.scope === "review") q = q.neq("sync_flag", "none").is("review_dismissed_at", null).order("start_date", { ascending: true, nullsFirst: false });
  else q = q.order("start_date", { ascending: true, nullsFirst: false });
  const { data, error } = await q.limit(500);
  if (error) throw new Error(error.message);
  const events = (data ?? []) as EventListItem[];
  if (!events.length) return [];
  const ids = events.map((e) => e.id);
  const [{ data: tasks }, { data: posts }] = await Promise.all([
    supabase.from("tasks").select("id,event_id,status").eq("user_id", userId).in("event_id", ids),
    supabase.from("social_posts").select("id,event_id,status").eq("user_id", userId).in("event_id", ids),
  ]);
  const t = (tasks ?? []) as { event_id: string; status: string }[];
  const p = (posts ?? []) as { event_id: string; status: string }[];
  return events.map((e) => ({
    ...e,
    prep_total: t.filter((x) => x.event_id === e.id).length,
    prep_open: t.filter((x) => x.event_id === e.id && x.status !== "completed").length,
    social_open: p.filter((x) => x.event_id === e.id && x.status !== "published").length,
  }));
}

export async function countReviewFlags(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_archived", false).neq("sync_flag", "none").is("review_dismissed_at", null);
  return count ?? 0;
}

export type EventDetail = {
  event: Event & { work_area?: { id: string; name: string; color: string } | null; project?: { id: string; name: string } | null };
  tasks: TaskWithRefs[];
  posts: SocialPostWithRefs[];
  notes: Note[];
  attachments: Attachment[];
  templates: EventTemplate[];
  templateItems: EventTemplateItem[];
  connection: Pick<MondayConnection, "board_name" | "last_success_at" | "last_error"> | null;
  socialBoard: Pick<MondayConnection, "board_name" | "board_id"> | null;
};

export async function getEventDetail(userId: string, id: string): Promise<EventDetail | null> {
  const supabase = await createClient();
  const { data: ev, error } = await supabase.from("events").select("*, work_area:work_areas(id,name,color), project:projects(id,name)").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!ev) return null;
  const [tasks, posts, notes, atts, templates, items, conn, social] = await Promise.all([
    supabase.from("tasks").select(TASK_SELECT).eq("event_id", id).order("status").order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("social_posts").select(SOCIAL_SELECT).eq("event_id", id).order("publish_date", { ascending: true, nullsFirst: false }),
    supabase.from("notes").select("*").eq("event_id", id).order("created_at", { ascending: false }),
    supabase.from("attachments").select("*").eq("event_id", id).order("created_at", { ascending: false }),
    supabase.from("event_templates").select("*").eq("user_id", userId).order("is_default", { ascending: false }).order("name"),
    supabase.from("event_template_items").select("*").eq("user_id", userId).order("sort_order"),
    supabase.from("monday_connections").select("board_name,last_success_at,last_error").eq("user_id", userId).eq("purpose", "events").maybeSingle(),
    supabase.from("monday_connections").select("board_name,board_id").eq("user_id", userId).eq("purpose", "social").maybeSingle(),
  ]);
  return {
    event: ev as EventDetail["event"],
    tasks: ((tasks.data ?? []) as Parameters<typeof shapeTask>[0][]).map(shapeTask),
    posts: ((posts.data ?? []) as SocialPostWithRefs[]).map(shapePost),
    notes: (notes.data ?? []) as Note[],
    attachments: (atts.data ?? []) as Attachment[],
    templates: (templates.data ?? []) as EventTemplate[],
    templateItems: (items.data ?? []) as EventTemplateItem[],
    connection: (conn.data ?? null) as EventDetail["connection"],
    socialBoard: (social.data ?? null) as EventDetail["socialBoard"],
  };
}
