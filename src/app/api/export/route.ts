import { type NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/data/workspace";
import { getCompletedData } from "@/lib/data/completed";
import { groupSummary, toCsv } from "@/lib/summary";
import { isDateOnly, isoToDateOnly } from "@/lib/dates";

export async function GET(request: NextRequest) {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const type = sp.get("type") ?? "tasks";
  const from = sp.get("from");
  const to = sp.get("to");
  if (!isDateOnly(from) || !isDateOnly(to) || from > to) return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  const area = sp.get("area");
  const project = sp.get("project");
  const uuid = /^[0-9a-f-]{36}$/i;
  const data = await getCompletedData(ws.userId, ws.today, ws.timezone, ws.profile.week_starts_on, {
    from,
    to,
    area: area && uuid.test(area) ? area : null,
    project: project && uuid.test(project) ? project : null,
  });

  let csv = "";
  if (type === "tasks") {
    csv = toCsv(
      data.tasks.map((t) => ({
        completed_on: t.completed_at ? isoToDateOnly(t.completed_at, ws.timezone) : "",
        title: t.title,
        project: t.project?.name ?? "",
        work_area: t.work_area?.name ?? "",
        priority: t.priority,
        due_date: t.due_date ?? "",
        estimated_minutes: t.estimated_minutes ?? "",
        event: t.event?.name ?? "",
      })),
    );
  } else if (type === "posts") {
    csv = toCsv(
      data.posts.map((p) => ({
        published_on: p.published_at ? isoToDateOnly(p.published_at, ws.timezone) : "",
        title: p.title,
        platform: p.platform ?? "",
        brand: p.brand ?? "",
        project: p.project?.name ?? "",
        work_area: p.work_area?.name ?? "",
        event: p.event?.name ?? "",
        published_url: p.published_url ?? "",
      })),
    );
  } else {
    const groups = groupSummary(data.tasks, data.posts, data.projects, "project");
    csv = toCsv(
      groups.flatMap((g) => [
        ...g.projects.map((pr) => ({ group: g.label, type: "project_completed", item: pr.name, date: pr.completed_at ? isoToDateOnly(pr.completed_at, ws.timezone) : "" })),
        ...g.tasks.map((t) => ({ group: g.label, type: "task_completed", item: t.title, date: t.completed_at ? isoToDateOnly(t.completed_at, ws.timezone) : "" })),
        ...g.posts.map((p) => ({ group: g.label, type: "post_published", item: p.title, date: p.published_at ? isoToDateOnly(p.published_at, ws.timezone) : "" })),
      ]),
    );
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="frady-os-${type}-${from}-to-${to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
