"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Plus, RefreshCw, Loader2, AlertTriangle, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EventRow, PageHeader, SectionHeader } from "@/components/app/items";
import { EventDialog } from "@/components/app/event-dialog";
import { useWorkspace } from "@/components/app/workspace-provider";
import { syncMondayNow } from "@/actions/monday";
import type { EventListItem } from "@/lib/data/events";
import type { MondayConnection } from "@/lib/types";
import { formatDate, formatTimestamp, timeAgo } from "@/lib/dates";

export function EventsView({ events, scope, area, reviewCount, connection, tokenConfigured }: { events: EventListItem[]; scope: string; area: string | null; reviewCount: number; connection: MondayConnection | null; tokenConfigured: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { workAreas, timezone } = useWorkspace();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function setParams(patch: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`${pathname}?${p.toString()}`);
  }

  function sync() {
    startTransition(async () => {
      const res = await syncMondayNow();
      if (!res.ok) return void toast.error(res.error, { duration: 8000 });
      const r = res.data;
      toast.success(`Synced ${r.items_seen} items: ${r.created} new, ${r.updated} updated, ${r.dates_changed} date changes`);
      router.refresh();
    });
  }

  const byMonth = groupByMonth(events);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Events"
        description={
          connection ? (
            <span>
              Monday.com board “{connection.board_name ?? connection.board_id}” ·{" "}
              {connection.last_success_at ? `last synced ${timeAgo(connection.last_success_at)} (${formatTimestamp(connection.last_success_at, timezone)})` : "never synced"}
              {connection.last_error ? <span className="text-destructive"> · last sync failed</span> : null}
            </span>
          ) : tokenConfigured ? (
            <span>
              Monday.com token is set. <Link href="/settings?tab=monday" className="text-primary hover:underline">Choose a board</Link> to start importing events.
            </span>
          ) : (
            <span>
              Monday.com is disconnected. Add events manually, or <Link href="/settings?tab=monday" className="text-primary hover:underline">set up the integration</Link>.
            </span>
          )
        }
        actions={
          <>
            {connection && tokenConfigured ? (
              <Button variant="outline" onClick={sync} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href="/settings?tab=monday"><Settings /> Monday.com</Link>
              </Button>
            )}
            <Button onClick={() => setDialogOpen(true)}>
              <Plus /> New event
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={scope} onValueChange={(v) => setParams({ scope: v === "upcoming" ? null : v })}>
            <TabsList>
              <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
              <TabsTrigger value="past">Past</TabsTrigger>
              <TabsTrigger value="review">
                Needs review{reviewCount ? <span className="bg-destructive text-destructive-foreground ml-1 rounded-full px-1.5 text-[10px] tabular-nums">{reviewCount}</span> : null}
              </TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
          <NativeSelect className="w-44" value={area ?? ""} onChange={(e) => setParams({ area: e.target.value || null })} aria-label="Work area">
            <option value="">All work areas</option>
            {workAreas.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </NativeSelect>
        </div>
      </PageHeader>

      {connection?.last_error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle />
          <AlertTitle>Last Monday.com sync failed</AlertTitle>
          <AlertDescription>{connection.last_error}</AlertDescription>
        </Alert>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={scope === "review" ? "Nothing needs review" : scope === "past" ? "No past events" : "No events yet"}
          description={scope === "review" ? "Canceled or removed Monday.com items will appear here." : "Import from Monday.com or add an event manually. Each event gets a preparation checklist and social plan."}
          action={scope !== "review" ? <Button onClick={() => setDialogOpen(true)}><Plus /> New event</Button> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {byMonth.map((g) => (
            <section key={g.key}>
              <SectionHeader title={g.label} count={g.events.length} />
              <div className="flex flex-col gap-1.5">
                {g.events.map((e) => (
                  <EventRow key={e.id} event={e} prepOpen={e.prep_open} prepTotal={e.prep_total} socialOpen={e.social_open} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <EventDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultAreaId={area} />
    </div>
  );
}

function groupByMonth(events: EventListItem[]) {
  const map = new Map<string, { key: string; label: string; events: EventListItem[] }>();
  for (const e of events) {
    const key = e.start_date ? e.start_date.slice(0, 7) : "none";
    const label = e.start_date ? formatDate(`${key}-01`, "monthYear") : "No date";
    if (!map.has(key)) map.set(key, { key, label, events: [] });
    map.get(key)!.events.push(e);
  }
  return Array.from(map.values());
}
