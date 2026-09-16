import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { listEvents, countReviewFlags } from "@/lib/data/events";
import { createClient } from "@/lib/supabase/server";
import { isMondayConfigured } from "@/lib/monday/client";
import { EventsView } from "./events-view";
import type { MondayConnection } from "@/lib/types";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  const sp = await searchParams;
  const ws = await requireWorkspace();
  const scope = (typeof sp.scope === "string" ? sp.scope : "upcoming") as "upcoming" | "past" | "review" | "all";
  const area = typeof sp.area === "string" && sp.area ? sp.area : null;
  const supabase = await createClient();
  const [events, reviewCount, conn] = await Promise.all([
    listEvents(ws.userId, ws.today, { scope, area }),
    countReviewFlags(ws.userId),
    supabase.from("monday_connections").select("*").eq("user_id", ws.userId).eq("purpose", "events").maybeSingle(),
  ]);
  return <EventsView events={events} scope={scope} area={area} reviewCount={reviewCount} connection={(conn.data ?? null) as MondayConnection | null} tokenConfigured={isMondayConfigured()} />;
}
