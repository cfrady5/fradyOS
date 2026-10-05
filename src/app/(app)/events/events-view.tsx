"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Plus, RefreshCw, Loader2, AlertTriangle, Settings, CheckSquare, X, Archive, Trash2, EyeOff, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProjectSelect } from "@/components/app/form-fields";
import { EventRow, PageHeader, SectionHeader } from "@/components/app/items";
import { EventDialog } from "@/components/app/event-dialog";
import { useWorkspace } from "@/components/app/workspace-provider";
import { syncMondayNow } from "@/actions/monday";
import { bulkDeleteEvents, bulkUpdateEvents } from "@/actions/events";
import { cn } from "@/lib/utils";
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
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [bulkPending, startBulk] = React.useTransition();
  const visibleIds = React.useMemo(() => events.map((e) => e.id), [events]);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const selectedEvents = events.filter((e) => selected.has(e.id));
  const selectedMonday = selectedEvents.filter((e) => e.source === "monday").length;
  const selectedFlagged = selectedEvents.filter((e) => e.sync_flag !== "none" && !e.review_dismissed_at).length;

  function toggleSelect(id: string, on?: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function exitSelect() {
    setSelecting(false);
    setSelected(new Set());
  }
  function applyBulk(patch: Record<string, unknown>, done: (n: number) => string) {
    if (!selectedVisible.length) return;
    startBulk(async () => {
      const res = await bulkUpdateEvents(selectedVisible, patch);
      if (!res.ok) return void toast.error(res.error);
      toast.success(done(res.data.updated));
      router.refresh();
    });
  }
  function deleteSelected() {
    startBulk(async () => {
      const res = await bulkDeleteEvents(selectedVisible);
      setConfirmDelete(false);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Deleted ${res.data.deleted} event${res.data.deleted === 1 ? "" : "s"}${res.data.excluded ? ` · ${res.data.excluded} kept out of Monday.com sync` : ""}`);
      exitSelect();
      router.refresh();
    });
  }

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
              Monday.com token is set. <Link href="/settings?tab=monday" className="text-primary-soft hover:underline">Choose a board</Link> to start importing events.
            </span>
          ) : (
            <span>
              Monday.com is disconnected. Add events manually, or <Link href="/settings?tab=monday" className="text-primary-soft hover:underline">set up the integration</Link>.
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
            {events.length ? (
              <Button variant={selecting ? "secondary" : "outline"} onClick={() => (selecting ? exitSelect() : setSelecting(true))} aria-pressed={selecting}>
                {selecting ? <X /> : <CheckSquare />} {selecting ? "Done" : "Select"}
              </Button>
            ) : null}
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
          {selecting ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Checkbox id="select-all" checked={selectedVisible.length === visibleIds.length ? true : selectedVisible.length ? "indeterminate" : false} onCheckedChange={(v) => setSelected(v ? new Set(visibleIds) : new Set())} />
              <label htmlFor="select-all" className="cursor-pointer select-none">
                Select all {visibleIds.length} shown
              </label>
              <span className="text-muted-foreground text-xs">Tick events, then use the bar at the bottom. Monday.com fields stay read-only; work area, project, archive and delete are yours.</span>
            </div>
          ) : null}
          {byMonth.map((g) => {
            const groupIds = g.events.map((e) => e.id);
            const groupSelected = groupIds.filter((id) => selected.has(id)).length;
            return (
              <section key={g.key}>
                <SectionHeader
                  title={
                    selecting ? (
                      <span className="inline-flex items-center gap-2">
                        <Checkbox aria-label={`Select all in ${g.label}`} checked={groupSelected === groupIds.length ? true : groupSelected ? "indeterminate" : false} onCheckedChange={(v) => setSelected((prev) => { const next = new Set(prev); for (const id of groupIds) { if (v) next.add(id); else next.delete(id); } return next; })} />
                        {g.label}
                      </span>
                    ) : (
                      g.label
                    )
                  }
                  count={g.events.length}
                />
                <div className="flex flex-col gap-1.5">
                  {g.events.map((e) => (
                    <div key={e.id} className={cn("flex items-stretch gap-2", selecting && selected.has(e.id) && "[&>a]:border-primary/50 [&>a]:bg-primary/8")}>
                      {selecting ? (
                        <label className="flex shrink-0 cursor-pointer items-center px-1" aria-label={`Select ${e.name}`}>
                          <Checkbox checked={selected.has(e.id)} onCheckedChange={(v) => toggleSelect(e.id, Boolean(v))} />
                        </label>
                      ) : null}
                      <EventRow event={e} prepOpen={e.prep_open} prepTotal={e.prep_total} socialOpen={e.social_open} className="min-w-0 flex-1" />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {selecting ? (
        <div className="bg-card border-border fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-xl border p-2.5 pr-16 shadow-2xl shadow-black/50 md:inset-x-auto md:right-8 md:bottom-6 md:left-[calc(15rem+2rem)] md:pr-2.5" role="toolbar" aria-label="Bulk actions">
          <span className="nums px-1 text-sm font-semibold">{selectedVisible.length} selected</span>
          <NativeSelect className="w-40" value="" disabled={!selectedVisible.length || bulkPending} onChange={(e) => { const v = e.target.value; if (v === "") return; applyBulk({ work_area_id: v === "__none" ? null : v }, (n) => `Work area set on ${n} event${n === 1 ? "" : "s"}`); }} aria-label="Set work area">
            <option value="">Set work area…</option>
            {workAreas.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
            <option value="__none">No work area</option>
          </NativeSelect>
          <BulkProjectSelect disabled={!selectedVisible.length || bulkPending} onPick={(v) => applyBulk({ project_id: v }, (n) => `Project set on ${n} event${n === 1 ? "" : "s"}`)} />
          {selectedFlagged ? (
            <Button variant="outline" size="sm" disabled={bulkPending} onClick={() => applyBulk({ dismiss_review: true }, (n) => `Review flags dismissed on ${n}`)}>
              <EyeOff /> Dismiss review
            </Button>
          ) : null}
          {scope === "all" && selectedEvents.some((e) => e.is_archived) ? (
            <Button variant="outline" size="sm" disabled={bulkPending} onClick={() => applyBulk({ is_archived: false }, (n) => `Restored ${n}`)}>
              <ArchiveRestore /> Unarchive
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={!selectedVisible.length || bulkPending} onClick={() => applyBulk({ is_archived: true }, (n) => `Archived ${n} event${n === 1 ? "" : "s"}`)}>
              <Archive /> Archive
            </Button>
          )}
          <Button variant="destructive" size="sm" disabled={!selectedVisible.length || bulkPending} onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={exitSelect}>
            Cancel
          </Button>
        </div>
      ) : null}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selectedVisible.length} event{selectedVisible.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              Linked tasks and posts are kept; only their event link is cleared. Notes and attachments on these events are deleted.
              {selectedMonday ? ` ${selectedMonday} of them came from Monday.com: they are kept out of future syncs until you restore them in Settings → Monday.com.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={bulkPending}>
              Keep them
            </Button>
            <Button variant="destructive" onClick={deleteSelected} disabled={bulkPending}>
              {bulkPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete {selectedVisible.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EventDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultAreaId={area} />
    </div>
  );
}

/** Project picker that applies on change and resets, so the same project can be applied twice. */
function BulkProjectSelect({ disabled, onPick }: { disabled: boolean; onPick: (projectId: string | null) => void }) {
  const [value, setValue] = React.useState<string | null>(null);
  return (
    <div className="w-44">
      <ProjectSelect
        value={value}
        onChange={(v) => {
          setValue(v);
          onPick(v);
          setTimeout(() => setValue(null), 0);
        }}
        className={disabled ? "pointer-events-none opacity-50" : undefined}
      />
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
