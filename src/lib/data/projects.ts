import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Attachment, Event, Note, Project, ProjectWithStats, SocialPostWithRefs, TaskWithRefs } from "@/lib/types";
import { shapeTask, TASK_SELECT } from "./tasks";

type RawProject = Project & {
  work_area: { id: string; name: string; color: string } | null;
  tasks?: { id: string; status: string; due_date: string | null }[] | null;
};

export function shapeProject(row: RawProject, today: string): ProjectWithStats {
  const tasks = row.tasks ?? [];
  const { tasks: _t, ...rest } = row;
  void _t;
  return {
    ...rest,
    links: Array.isArray(rest.links) ? rest.links : [],
    task_total: tasks.length,
    task_done: tasks.filter((t) => t.status === "completed").length,
    overdue_count: tasks.filter((t) => t.status !== "completed" && t.due_date && t.due_date < today).length,
    waiting_count: tasks.filter((t) => t.status === "waiting").length,
  };
}

const PROJECT_SELECT = "*, work_area:work_areas(id,name,color), tasks(id,status,due_date)";

export async function listProjects(
  userId: string,
  today: string,
  opts: { area?: string | null; status?: string | null; includeArchived?: boolean } = {},
): Promise<ProjectWithStats[]> {
  const supabase = await createClient();
  let q = supabase.from("projects").select(PROJECT_SELECT).eq("user_id", userId);
  if (opts.area) q = q.eq("work_area_id", opts.area);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  else if (!opts.includeArchived) q = q.neq("status", "archived");
  q = q.order("status").order("priority", { ascending: false }).order("target_date", { ascending: true, nullsFirst: false }).order("name");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawProject[]).map((p) => shapeProject(p, today));
}

export type ProjectDetail = {
  project: ProjectWithStats;
  tasks: TaskWithRefs[];
  events: Event[];
  posts: SocialPostWithRefs[];
  notes: Note[];
  attachments: Attachment[];
};

export async function getProjectDetail(userId: string, id: string, today: string): Promise<ProjectDetail | null> {
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!project) return null;

  const [tasks, events, posts, notes, atts] = await Promise.all([
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("project_id", id)
      .order("status")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase.from("events").select("*").eq("project_id", id).order("start_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("social_posts")
      .select("*, event:events(id,name,start_date), work_area:work_areas(id,name,color), project:projects(id,name)")
      .eq("project_id", id)
      .order("publish_date", { ascending: true, nullsFirst: false }),
    supabase.from("notes").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("attachments").select("*").eq("project_id", id).order("created_at", { ascending: false }),
  ]);

  return {
    project: shapeProject(project as RawProject, today),
    tasks: ((tasks.data ?? []) as Parameters<typeof shapeTask>[0][]).map(shapeTask),
    events: (events.data ?? []) as Event[],
    posts: (posts.data ?? []) as SocialPostWithRefs[],
    notes: (notes.data ?? []) as Note[],
    attachments: (atts.data ?? []) as Attachment[],
  };
}
