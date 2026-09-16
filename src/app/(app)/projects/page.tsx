import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { listProjects } from "@/lib/data/projects";
import { ProjectsView } from "./projects-view";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const sp = await searchParams;
  const ws = await requireWorkspace();
  const area = typeof sp.area === "string" ? sp.area : null;
  const status = typeof sp.status === "string" ? sp.status : null;
  const projects = await listProjects(ws.userId, ws.today, { area, status: status ?? undefined, includeArchived: status === "archived" || status === "all" });
  return <ProjectsView projects={projects} area={area} status={status} workAreas={ws.workAreas} />;
}
