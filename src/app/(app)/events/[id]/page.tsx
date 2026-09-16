import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/data/workspace";
import { getEventDetail } from "@/lib/data/events";
import { EventDetailView } from "./event-detail-view";

export async function generateMetadata({ params }: PageProps<"/events/[id]">): Promise<Metadata> {
  const { id } = await params;
  const ws = await requireWorkspace();
  const d = await getEventDetail(ws.userId, id).catch(() => null);
  return { title: d?.event.name ?? "Event" };
}

export default async function EventDetailPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const ws = await requireWorkspace();
  const detail = await getEventDetail(ws.userId, id);
  if (!detail) notFound();
  return <EventDetailView detail={detail} />;
}
