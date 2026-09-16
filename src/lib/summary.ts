import type { ProjectWithStats, SocialPostWithRefs, TaskWithRefs } from "@/lib/types";
import { formatDate, isoToDateOnly } from "@/lib/dates";

export type SummaryGroup = { key: string; label: string; tasks: TaskWithRefs[]; posts: SocialPostWithRefs[]; projects: ProjectWithStats[] };

export function groupSummary(tasks: TaskWithRefs[], posts: SocialPostWithRefs[], projects: ProjectWithStats[], by: "project" | "area"): SummaryGroup[] {
  const map = new Map<string, SummaryGroup>();
  const get = (key: string, label: string) => {
    if (!map.has(key)) map.set(key, { key, label, tasks: [], posts: [], projects: [] });
    return map.get(key)!;
  };
  for (const t of tasks) {
    const k = by === "project" ? (t.project?.id ?? "none") : (t.work_area?.id ?? "none");
    const l = by === "project" ? (t.project?.name ?? "No project") : (t.work_area?.name ?? "No work area");
    get(k, l).tasks.push(t);
  }
  for (const p of posts) {
    const k = by === "project" ? (p.project?.id ?? "none") : (p.work_area?.id ?? "none");
    const l = by === "project" ? (p.project?.name ?? "No project") : (p.work_area?.name ?? "No work area");
    get(k, l).posts.push(p);
  }
  for (const pr of projects) {
    const k = by === "project" ? pr.id : (pr.work_area?.id ?? "none");
    const l = by === "project" ? pr.name : (pr.work_area?.name ?? "No work area");
    get(k, l).projects.push(pr);
  }
  return Array.from(map.values()).sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : a.label.localeCompare(b.label)));
}

/** Plain-text/markdown summary for pasting into a manager update. Only lists real records. */
export function summaryMarkdown(opts: { from: string; to: string; groups: SummaryGroup[]; carryOver: TaskWithRefs[]; timeZone: string; by: "project" | "area" }): string {
  const { from, to, groups, carryOver, timeZone } = opts;
  const lines: string[] = [];
  lines.push(`Update for ${formatDate(from, "medium")} – ${formatDate(to, "medium")}`);
  lines.push("");
  const total = groups.reduce((n, g) => n + g.tasks.length + g.posts.length + g.projects.length, 0);
  if (total === 0) {
    lines.push("No tasks completed, posts published or projects closed in this period.");
  }
  for (const g of groups) {
    if (!g.tasks.length && !g.posts.length && !g.projects.length) continue;
    lines.push(`## ${g.label}`);
    for (const pr of g.projects) lines.push(`- Project completed: ${pr.name}`);
    for (const t of g.tasks) lines.push(`- ${t.title}${t.completed_at ? ` (${formatDate(isoToDateOnly(t.completed_at, timeZone), "short")})` : ""}`);
    for (const p of g.posts) lines.push(`- Published: ${p.title}${p.platform ? ` on ${p.platform}` : ""}${p.published_url ? ` — ${p.published_url}` : ""}`);
    lines.push("");
  }
  if (carryOver.length) {
    lines.push("## Carrying into next week");
    for (const t of carryOver) lines.push(`- ${t.title}${t.due_date ? ` (due ${formatDate(t.due_date, "short")})` : ""}${t.project ? ` — ${t.project.name}` : ""}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function toCsv(rows: Record<string, string | number | null | undefined>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\r\n");
}
