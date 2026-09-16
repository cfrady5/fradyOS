import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/data/workspace";
import { getProjectDetail } from "@/lib/data/projects";
import { ProjectDetailView } from "./project-detail-view";

export async function generateMetadata({ params }: PageProps<"/projects/[id]">): Promise<Metadata> {
  const { id } = await params;
  const ws = await requireWorkspace();
  const d = await getProjectDetail(ws.userId, id, ws.today).catch(() => null);
  return { title: d?.project.name ?? "Project" };
}

export default async function ProjectDetailPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const ws = await requireWorkspace();
  const detail = await getProjectDetail(ws.userId, id, ws.today);
  if (!detail) notFound();
  return <ProjectDetailView detail={detail} />;
}
