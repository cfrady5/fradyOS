"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Hourglass, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, SectionHeader, AreaDot } from "@/components/app/items";
import { WaitingActions } from "@/components/app/waiting-actions";
import { useShell } from "@/components/app/app-shell";
import { useWorkspace } from "@/components/app/workspace-provider";
import { useOpenItem } from "@/hooks/use-open-item";
import type { TaskWithRefs } from "@/lib/types";
import { formatDate, relativeDayLabel, formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function WaitingView({ tasks, received, area, showReceived }: { tasks: TaskWithRefs[]; received: TaskWithRefs[]; area: string | null; showReceived: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { workAreas, today, timezone } = useWorkspace();
  const { openQuickAdd } = useShell();
  const { taskHref } = useOpenItem();

  function setParams(patch: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`${pathname}?${p.toString()}`);
  }

  const attention = tasks.filter((t) => (t.waiting_expected_date && t.waiting_expected_date < today) || (t.waiting_followup_date && t.waiting_followup_date <= today));
  const onTrack = tasks.filter((t) => !attention.includes(t));
  const sortKey = (t: TaskWithRefs) => t.waiting_followup_date ?? t.waiting_expected_date ?? "9999";
  attention.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  onTrack.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Waiting On"
        description="Deliverables other people owe you. Their delivery deadline and your follow-up date are tracked separately. Nothing is sent automatically."
        actions={
          <Button onClick={() => openQuickAdd({ status: "waiting", work_area_id: area })}>
            <Plus /> Add waiting item
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect className="w-44" value={area ?? ""} onChange={(e) => setParams({ area: e.target.value || null })} aria-label="Work area">
            <option value="">All work areas</option>
            {workAreas.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </NativeSelect>
          <Button variant="ghost" size="sm" onClick={() => setParams({ received: showReceived ? null : "1" })}>
            {showReceived ? "Hide received" : "Show recently received"}
          </Button>
        </div>
      </PageHeader>

      {tasks.length === 0 ? (
        <EmptyState icon={<Hourglass />} title="You're not waiting on anyone" description="When you hand something off, set the task status to “Waiting on Someone” and record who owes what, when they promised it, and when you'll follow up." action={<Button onClick={() => openQuickAdd({ status: "waiting" })}><Plus /> Add waiting item</Button>} />
      ) : (
        <div className="flex flex-col gap-6">
          {attention.length ? (
            <section>
              <SectionHeader title={<span className="text-destructive">Needs attention</span>} count={attention.length} hint="late deliveries or follow-ups due" />
              <WaitingTable tasks={attention} today={today} taskHref={taskHref} />
            </section>
          ) : null}
          <section>
            <SectionHeader title="On track" count={onTrack.length} />
            {onTrack.length ? <WaitingTable tasks={onTrack} today={today} taskHref={taskHref} /> : <p className="text-muted-foreground text-xs">Everything else is waiting on a future date.</p>}
          </section>
        </div>
      )}

      {showReceived ? (
        <section className="mt-6">
          <SectionHeader title="Recently received" count={received.length} />
          {received.length ? (
            <ul className="flex flex-col gap-1.5">
              {received.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
                  <Link href={taskHref(t.id)} scroll={false} className="font-medium hover:underline">{t.title}</Link>
                  <span className="text-muted-foreground text-xs">from {t.waiting_person ?? "someone"} · received {formatTimestamp(t.waiting_received_at, timezone)}</span>
                  <Badge variant={t.status === "completed" ? "success" : "secondary"} className="ml-auto">{t.status === "completed" ? "Completed" : "Back in To Do"}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">Nothing marked received yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function WaitingTable({ tasks, today, taskHref }: { tasks: TaskWithRefs[]; today: string; taskHref: (id: string) => string }) {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Deliverable</TableHead>
            <TableHead>Person</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead>Their deadline</TableHead>
            <TableHead>My follow-up</TableHead>
            <TableHead>Last follow-up</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((t) => {
            const lateDelivery = t.waiting_expected_date && t.waiting_expected_date < today;
            const followupDue = t.waiting_followup_date && t.waiting_followup_date <= today;
            return (
              <TableRow key={t.id} className={cn(lateDelivery && "bg-destructive/5")}>
                <TableCell className="max-w-xs whitespace-normal align-top">
                  <Link href={taskHref(t.id)} scroll={false} className="font-medium hover:underline">{t.title}</Link>
                  {t.waiting_need ? <p className="text-muted-foreground text-xs">Need: {t.waiting_need}</p> : null}
                  <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                    {t.work_area ? <span className="inline-flex items-center gap-1"><AreaDot color={t.work_area.color} /> {t.work_area.name}</span> : null}
                    {t.project ? <span>{t.project.name}</span> : null}
                    {t.event ? <span>📅 {t.event.name}</span> : null}
                  </p>
                </TableCell>
                <TableCell className="align-top">{t.waiting_person ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="align-top tabular-nums">{t.waiting_requested_date ? formatDate(t.waiting_requested_date, "medium", today) : "—"}</TableCell>
                <TableCell className="align-top">
                  {t.waiting_expected_date ? (
                    <Badge variant={lateDelivery ? "destructive" : "muted"} className="tabular-nums">{lateDelivery ? "Late · " : ""}{relativeDayLabel(t.waiting_expected_date, today)}</Badge>
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="align-top">
                  {t.waiting_followup_date ? (
                    <Badge variant={followupDue ? "warning" : "secondary"} className="tabular-nums">{t.waiting_followup_date === today ? "Today" : relativeDayLabel(t.waiting_followup_date, today)}</Badge>
                  ) : <span className="text-muted-foreground">Not scheduled</span>}
                </TableCell>
                <TableCell className="align-top tabular-nums">{t.waiting_last_followup_date ? relativeDayLabel(t.waiting_last_followup_date, today) : <span className="text-muted-foreground">Never</span>}</TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex justify-end"><WaitingActions task={t} compact /></div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
