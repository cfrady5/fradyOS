import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Sparkles } from "lucide-react";
import { requireWorkspace } from "@/lib/data/workspace";
import { getTodayData } from "@/lib/data/today";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/app/items";
import { Button } from "@/components/ui/button";
import { TodayView } from "./today-view";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const ws = await requireWorkspace();
  const data = await getTodayData(ws.userId, ws.today);
  const firstName = ws.profile.display_name?.split(" ")[0];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={<span>{greeting()}{firstName ? `, ${firstName}` : ""}</span>}
        description={formatDate(ws.today, "long")}
        actions={
          data.counts.inbox > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/tasks?status=inbox">
                <Inbox /> {data.counts.inbox} in inbox to triage
              </Link>
            </Button>
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <Sparkles className="size-3.5" /> Inbox zero
            </span>
          )
        }
      />
      <TodayView data={data} />
    </div>
  );
}

function greeting() {
  // Greeting is cosmetic; use the server clock hour in UTC-5/-4 approximated by the user's zone at render time.
  const h = new Date().getUTCHours();
  const local = (h + 24 - 4) % 24; // Indiana is UTC-4 (EDT) or UTC-5 (EST); close enough for a greeting
  if (local < 12) return "Good morning";
  if (local < 17) return "Good afternoon";
  return "Good evening";
}
