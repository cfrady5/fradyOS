"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical, Plus, Pencil, Target, FolderKanban, Link2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { RowList, SectionHeader } from "@/components/app/items";
import { ProgressMeter } from "@/components/finance/charts";
import { Disclaimer, GoalStatusBadge } from "@/components/finance/bits";
import { GoalDialog, LinkProjectDialog } from "@/components/finance/goal-dialog";
import { applyGoalAllocation, reorderGoals } from "@/actions/finance";
import type { AllocationLine, Projection } from "@/lib/finance/engine";
import { GOAL_CATEGORIES, type FinancialAccount, type FinancialGoal } from "@/lib/finance/types";
import { GOAL_STATUS_META } from "@/lib/finance/model";
import { fmtMoney, fmtMonths } from "@/lib/finance/format";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

type LinkedProject = { id: string; name: string; status: string; task_total: number; task_done: number };

export function GoalsView({ goals, accounts, projection, allocation, suggestedProjection, available, linkedProjects }: { goals: FinancialGoal[]; accounts: FinancialAccount[]; projection: Projection; allocation: AllocationLine[]; suggestedProjection: Projection; available: number; linkedProjects: LinkedProject[] }) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<{ open: boolean; goal?: FinancialGoal }>({ open: false });
  const [linkFor, setLinkFor] = React.useState<FinancialGoal | null>(null);
  const [pending, startTransition] = React.useTransition();
  const resultById = new Map(projection.goals.map((g) => [g.id, g]));
  const suggestedById = new Map(suggestedProjection.goals.map((g) => [g.id, g]));
  const projectById = new Map(linkedProjects.map((p) => [p.id, p]));

  const activeGoals = goals.filter((g) => g.status === "active" || g.status === "paused");
  const doneGoals = goals.filter((g) => g.status === "completed");
  const [order, setOrder] = React.useState(activeGoals.map((g) => g.id));
  const serverOrder = activeGoals.map((g) => g.id).join(",");
  const [prevServerOrder, setPrevServerOrder] = React.useState(serverOrder);
  if (prevServerOrder !== serverOrder) {
    setPrevServerOrder(serverOrder);
    setOrder(activeGoals.map((g) => g.id));
  }
  const ordered = order.map((id) => activeGoals.find((g) => g.id === id)).filter((g): g is FinancialGoal => Boolean(g));
  const dragId = React.useRef<string | null>(null);

  function commitOrder(next: string[]) {
    setOrder(next);
    startTransition(async () => {
      const res = await reorderGoals(next);
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }
  function move(id: string, dir: -1 | 1) {
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    commitOrder(next);
  }
  function onDrop(targetId: string) {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === targetId) return;
    const next = order.filter((x) => x !== from);
    next.splice(next.indexOf(targetId), 0, from);
    commitOrder(next);
  }

  const allocationDiffers = allocation.some((l) => Math.abs(l.suggestedMonthly - (goals.find((g) => g.id === l.goalId)?.monthly_contribution ?? 0)) > 0.5);
  function applyAllocation() {
    startTransition(async () => {
      const res = await applyGoalAllocation(allocation.map((l) => ({ goalId: l.goalId, monthly: l.suggestedMonthly })));
      if (!res.ok) return void toast.error(res.error);
      toast.success("Contributions updated from the allocation");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-text-2 max-w-2xl text-sm">Drag to set priority. Status compares each goal&rsquo;s projected completion with its target date.</p>
        <Button size="sm" onClick={() => setDialog({ open: true })}>
          <Plus /> New goal
        </Button>
      </div>

      {ordered.length === 0 ? (
        <EmptyState variant="page" icon={<Target />} title="No goals yet" description="An emergency fund, a debt to clear, a down payment, a trip. Give it a target and a date and the projection tells you whether you are on track." action={<Button onClick={() => setDialog({ open: true })}><Plus /> New goal</Button>} />
      ) : (
        <div className="grid gap-x-10 gap-y-7 lg:grid-cols-5">
          <div className="flex min-w-0 flex-col gap-2 lg:col-span-3">
            {ordered.map((g, idx) => {
              const r = resultById.get(g.id);
              const proj = g.linked_project_id ? projectById.get(g.linked_project_id) : null;
              const tone = r ? GOAL_STATUS_META[r.status].tone : "neutral";
              return (
                <Card
                  key={g.id}
                  className={cn("hover:border-line-2 gap-2 py-3 transition-colors", g.status === "paused" ? "opacity-70" : null)}
                  draggable
                  onDragStart={() => {
                    dragId.current = g.id;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(g.id)}
                >
                  <CardContent className="flex gap-3">
                    <div className="flex flex-col items-center gap-0.5 pt-0.5">
                      <button type="button" className="text-text-3 focus-visible:ring-brand/40 cursor-grab rounded-sm outline-none focus-visible:ring-2" aria-label={`Drag to reorder ${g.name}`} title="Drag to reorder">
                        <GripVertical className="size-4" />
                      </button>
                      <span className="index">{String(idx + 1).padStart(2, "0")}</span>
                      <div className="flex flex-col">
                        <button type="button" className="text-text-3 hover:text-text-1 focus-visible:ring-brand/40 flex size-5 items-center justify-center rounded-sm outline-none focus-visible:ring-2 disabled:opacity-30" onClick={() => move(g.id, -1)} disabled={idx === 0} aria-label={`Move ${g.name} up`}>
                          <ChevronUp className="size-3.5" />
                        </button>
                        <button type="button" className="text-text-3 hover:text-text-1 focus-visible:ring-brand/40 flex size-5 items-center justify-center rounded-sm outline-none focus-visible:ring-2 disabled:opacity-30" onClick={() => move(g.id, 1)} disabled={idx === ordered.length - 1} aria-label={`Move ${g.name} down`}>
                          <ChevronDown className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-text-1 text-sm font-medium">{g.name}</span>
                        <Badge variant="muted">{GOAL_CATEGORIES.find((c) => c.value === g.category)?.label}</Badge>
                        {g.status === "paused" ? <Badge variant="outline">Paused</Badge> : null}
                        {r ? <GoalStatusBadge status={r.status} /> : null}
                        <span className="flex-1" />
                        <Button variant="ghost" size="icon-xs" aria-label={`Edit ${g.name}`} onClick={() => setDialog({ open: true, goal: g })}>
                          <Pencil />
                        </Button>
                      </div>
                      {r ? (
                        <>
                          <ProgressMeter value={r.startAmount} target={r.targetAmount} tone={tone} />
                          <div className="text-text-3 nums text-meta flex flex-wrap justify-between gap-x-3">
                            <span>
                              {fmtMoney(r.startAmount)} of {fmtMoney(r.targetAmount)} ({r.progressPct.toFixed(0)}%) · {fmtMoney(g.monthly_contribution)}/mo
                            </span>
                            <span>
                              {r.projectedDate ? `Projected ${formatDate(r.projectedDate, "monthYear")}` : r.status === "completed" ? "Done" : "Not reached in horizon"}
                              {g.target_date ? ` · target ${formatDate(g.target_date, "monthYear")}` : ""}
                              {r.monthsDiff != null && r.status !== "completed" ? ` (${r.monthsDiff <= 0 ? `${fmtMonths(-r.monthsDiff)} early` : `${fmtMonths(r.monthsDiff)} late`})` : ""}
                            </span>
                          </div>
                          {r.requiredMonthly != null && r.requiredMonthly > g.monthly_contribution + 0.5 && r.status !== "completed" ? (
                            <p className="text-warning text-meta">Needs about {fmtMoney(r.requiredMonthly)}/mo to land on the target date.</p>
                          ) : null}
                        </>
                      ) : null}
                      <div className="text-meta flex flex-wrap items-center gap-2">
                        {proj ? (
                          <Link href={`/projects/${proj.id}`} className="text-brand-soft inline-flex items-center gap-1 hover:underline">
                            <FolderKanban className="size-3.5" /> {proj.name} · {proj.task_done}/{proj.task_total} tasks
                          </Link>
                        ) : (
                          <button type="button" className="text-text-3 hover:text-text-1 focus-visible:ring-brand/40 inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2" onClick={() => setLinkFor(g)}>
                            <Link2 className="size-3.5" /> Turn into a project
                          </button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {doneGoals.length ? (
              <div className="mt-5">
                <SectionHeader title="Completed" count={doneGoals.length} />
                <RowList>
                  {doneGoals.map((g) => (
                    <div key={g.id} className="text-text-3 flex items-center justify-between px-2 py-1.5 text-sm">
                      <span className="line-through">{g.name}</span>
                      <Button variant="ghost" size="icon-xs" aria-label={`Edit ${g.name}`} onClick={() => setDialog({ open: true, goal: g })}>
                        <Pencil />
                      </Button>
                    </div>
                  ))}
                </RowList>
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            <section aria-labelledby="goals-allocation">
              <SectionHeader as="h3" title={<span id="goals-allocation">Allocation by priority</span>} />
              <p className="text-text-2 text-meta mt-2">
                <span className="nums text-text-1 font-medium">{fmtMoney(available)}/mo</span> is available for goals (unallocated cash flow plus current goal contributions). Higher priority is funded first, up to what it needs for its date.
              </p>
              <RowList className="mt-2">
                {allocation.map((l) => {
                  const cur = goals.find((g) => g.id === l.goalId)?.monthly_contribution ?? 0;
                  const s = suggestedById.get(l.goalId);
                  return (
                    <div key={l.goalId} className="flex flex-col gap-0.5 px-2 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-text-1 truncate">{l.name}</span>
                        <span className="nums">
                          <span className="text-text-3">{fmtMoney(cur)} →</span> <span className="text-text-1 font-medium">{fmtMoney(l.suggestedMonthly)}</span>
                        </span>
                      </div>
                      <div className="text-text-3 text-meta flex items-center justify-between gap-2">
                        <span>{l.requiredMonthly != null ? `needs ${fmtMoney(l.requiredMonthly)}/mo for its date` : "no target date"}</span>
                        {s ? <GoalStatusBadge status={s.status} /> : null}
                      </div>
                    </div>
                  );
                })}
              </RowList>
              <div className="mt-3 flex flex-col gap-3">
                <Button size="sm" className="w-fit" onClick={applyAllocation} loading={pending} disabled={pending || !allocationDiffers}>
                  {allocationDiffers ? "Apply this allocation" : "Contributions already match"}
                </Button>
                <Disclaimer />
              </div>
            </section>
          </div>
        </div>
      )}

      <GoalDialog key={dialog.goal?.id ?? "new"} open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))} goal={dialog.goal} accounts={accounts} emergencyFundTarget={projection.emergencyFundTarget} />
      <LinkProjectDialog open={Boolean(linkFor)} onOpenChange={(v) => !v && setLinkFor(null)} goal={linkFor} />
    </div>
  );
}
