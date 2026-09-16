import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProjectWithStats, SocialPostWithRefs, TaskWithRefs } from "@/lib/types";
import { shapeTask, TASK_SELECT } from "./tasks";
import { SOCIAL_SELECT, shapePost } from "./social";
import { shapeProject } from "./projects";
import { addDays, dateOnlyIn, endOfWeek, startOfWeek } from "@/lib/dates";

export type CompletedFilters = { from: string; to: string; area?: string | null; project?: string | null };

export type CompletedData = {
  tasks: TaskWithRefs[];
  posts: SocialPostWithRefs[];
  projects: ProjectWithStats[];
  carryOver: TaskWithRefs[];
  counts: { tasksThisWeek: number; tasksThisMonth: number; postsThisWeek: number; postsThisMonth: number };
};

/** Converts a date-only range in the user's zone to UTC instants covering those days. */
function rangeToInstants(from: string, to: string, timeZone: string) {
  // Find the UTC instant of local midnight by probing.
  const startProbe = new Date(`${from}T00:00:00Z`);
  const endProbe = new Date(`${addDays(to, 1)}T00:00:00Z`);
  const fix = (probe: Date, target: string) => {
    // Adjust probe until its date in the zone equals target at 00:00 local (within ±14h).
    let t = probe.getTime() - 14 * 3600_000;
    for (let i = 0; i < 29 * 4; i++) {
      const d = new Date(t);
      if (dateOnlyIn(d, timeZone) === target) {
        // step back to the first minute of that day
        let s = t;
        while (dateOnlyIn(new Date(s - 60_000), timeZone) === target) s -= 60_000;
        return new Date(s).toISOString();
      }
      t += 15 * 60_000;
    }
    return probe.toISOString();
  };
  return { startIso: fix(startProbe, from), endIso: fix(endProbe, addDays(to, 1)) };
}

export async function getCompletedData(userId: string, today: string, timeZone: string, weekStartsOn: 0 | 1, f: CompletedFilters): Promise<CompletedData> {
  const supabase = await createClient();
  const { startIso, endIso } = rangeToInstants(f.from, f.to, timeZone);

  let tq = supabase.from("tasks").select(TASK_SELECT).eq("user_id", userId).eq("status", "completed").gte("completed_at", startIso).lt("completed_at", endIso).order("completed_at", { ascending: false }).limit(1000);
  let pq = supabase.from("social_posts").select(SOCIAL_SELECT).eq("user_id", userId).eq("status", "published").gte("published_at", startIso).lt("published_at", endIso).order("published_at", { ascending: false }).limit(500);
  let prq = supabase.from("projects").select("*, work_area:work_areas(id,name,color), tasks(id,status,due_date)").eq("user_id", userId).eq("status", "completed").gte("completed_at", startIso).lt("completed_at", endIso).order("completed_at", { ascending: false });
  if (f.area) {
    tq = tq.eq("work_area_id", f.area);
    pq = pq.eq("work_area_id", f.area);
    prq = prq.eq("work_area_id", f.area);
  }
  if (f.project) {
    tq = tq.eq("project_id", f.project);
    pq = pq.eq("project_id", f.project);
    prq = prq.eq("id", f.project);
  }

  const weekStart = startOfWeek(today, weekStartsOn);
  const weekEnd = endOfWeek(today, weekStartsOn);
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekI = rangeToInstants(weekStart, weekEnd, timeZone);
  const monthI = rangeToInstants(monthStart, today, timeZone);

  const [tasks, posts, projects, carry, wk, mo, pwk, pmo] = await Promise.all([
    tq,
    pq,
    prq,
    supabase.from("tasks").select(TASK_SELECT).eq("user_id", userId).neq("status", "completed").lte("due_date", weekEnd).order("due_date").limit(200),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "completed").gte("completed_at", weekI.startIso).lt("completed_at", weekI.endIso),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "completed").gte("completed_at", monthI.startIso),
    supabase.from("social_posts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "published").gte("published_at", weekI.startIso).lt("published_at", weekI.endIso),
    supabase.from("social_posts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "published").gte("published_at", monthI.startIso),
  ]);
  if (tasks.error) throw new Error(tasks.error.message);

  return {
    tasks: ((tasks.data ?? []) as Parameters<typeof shapeTask>[0][]).map(shapeTask),
    posts: ((posts.data ?? []) as SocialPostWithRefs[]).map(shapePost),
    projects: ((projects.data ?? []) as Parameters<typeof shapeProject>[0][]).map((p) => shapeProject(p, today)),
    carryOver: ((carry.data ?? []) as Parameters<typeof shapeTask>[0][]).map(shapeTask),
    counts: { tasksThisWeek: wk.count ?? 0, tasksThisMonth: mo.count ?? 0, postsThisWeek: pwk.count ?? 0, postsThisMonth: pmo.count ?? 0 },
  };
}
