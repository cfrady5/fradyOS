"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Flag, Target, CreditCard, TrendingUp, CalendarDays, Check, Pencil, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { DateInput, Field } from "@/components/app/form-fields";
import { Disclaimer, GoalStatusBadge, MoneyInput } from "@/components/finance/bits";
import { createMilestone, deleteMilestone, updateMilestone } from "@/actions/finance";
import type { GoalStatusKey } from "@/lib/finance/engine";
import type { FinancialGoal, FinancialMilestone, MilestoneType } from "@/lib/finance/types";
import { fmtMoney } from "@/lib/finance/format";
import { formatDate, parseDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type TimelineEntry = {
  id: string;
  kind: "goal" | "debt" | "net_worth" | "milestone";
  title: string;
  date: string | null;
  projectedDate: string | null;
  targetDate: string | null;
  amount: number | null;
  status?: GoalStatusKey;
  done?: boolean;
  milestone?: FinancialMilestone;
  eventName?: string | null;
  href: string;
};

const KIND_ICON = { goal: Target, debt: CreditCard, net_worth: TrendingUp, milestone: Flag } as const;

export function TimelineView({ entries, today, milestones, goals, events }: { entries: TimelineEntry[]; today: string; milestones: FinancialMilestone[]; goals: FinancialGoal[]; events: { id: string; name: string; start_date: string | null }[] }) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<{ open: boolean; milestone?: FinancialMilestone }>({ open: false });
  const [pending, startTransition] = React.useTransition();
  void milestones;

  function toggleDone(m: FinancialMilestone) {
    startTransition(async () => {
      const res = await updateMilestone(m.id, { is_done: !m.is_done });
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
    });
  }

  const byYear = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const y = e.date ? String(parseDateOnly(e.date).y) : "No date yet";
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(e);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">Projected goal completions, debt payoffs and net worth thresholds, alongside the life events you add.</p>
        <Button onClick={() => setDialog({ open: true })}>
          <Plus /> Add life event
        </Button>
      </div>
      {entries.length === 0 ? (
        <EmptyState icon={<Flag />} title="Nothing on the timeline yet" description="Add goals and debts, or a life event like a wedding or a move, and they show up here in order." action={<Button onClick={() => setDialog({ open: true })}><Plus /> Add life event</Button>} />
      ) : (
        <ol className="relative flex flex-col gap-6 border-l pl-6">
          {Array.from(byYear.entries()).map(([year, items]) => (
            <li key={year}>
              <div className="bg-background text-muted-foreground -ml-6 mb-2 inline-block pr-2 text-xs font-semibold uppercase tracking-wide">
                <span className="bg-border mr-3 inline-block size-2 rounded-full align-middle" /> {year}
              </div>
              <ul className="flex flex-col gap-2">
                {items.map((e) => {
                  const Icon = KIND_ICON[e.kind];
                  const past = e.date ? e.date < today : false;
                  return (
                    <li key={e.id} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2", e.done ? "opacity-60" : null)}>
                      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Link href={e.href} className={cn("font-medium hover:underline", e.done ? "line-through" : null)}>
                            {e.title}
                          </Link>
                          {e.status ? <GoalStatusBadge status={e.status} /> : null}
                          {e.eventName ? (
                            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                              <CalendarDays className="size-3" /> {e.eventName}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-muted-foreground text-xs tabular-nums">
                          {e.date ? formatDate(e.date, "monthYear") : "No date"}
                          {e.kind !== "milestone" && e.projectedDate ? " · projected" : ""}
                          {e.kind === "goal" && e.targetDate ? ` · target ${formatDate(e.targetDate, "monthYear")}` : ""}
                          {e.amount != null ? ` · ${fmtMoney(e.amount)}` : ""}
                          {past && !e.done ? " · past" : ""}
                        </div>
                      </div>
                      {e.milestone ? (
                        <div className="flex items-center gap-0.5">
                          <Button variant="ghost" size="icon-xs" aria-label={e.milestone.is_done ? "Mark not done" : "Mark done"} onClick={() => toggleDone(e.milestone!)} disabled={pending}>
                            <Check className={cn(e.milestone.is_done ? "text-success" : null)} />
                          </Button>
                          <Button variant="ghost" size="icon-xs" aria-label="Edit" onClick={() => setDialog({ open: true, milestone: e.milestone })}>
                            <Pencil />
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <Disclaimer />
      <MilestoneDialog key={dialog.milestone?.id ?? "new"} open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))} milestone={dialog.milestone} goals={goals} events={events} />
    </div>
  );
}

function MilestoneDialog({ open, onOpenChange, milestone, goals, events }: { open: boolean; onOpenChange: (v: boolean) => void; milestone?: FinancialMilestone; goals: FinancialGoal[]; events: { id: string; name: string; start_date: string | null }[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{milestone ? "Edit life event" : "Add life event"}</DialogTitle>
          <DialogDescription>A wedding, a move, a degree, a trip. Link it to a goal or a FradyOS event so the timeline shows the money next to the moment.</DialogDescription>
        </DialogHeader>
        <MilestoneForm milestone={milestone} goals={goals} events={events} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function MilestoneForm({ milestone, goals, events, onClose }: { milestone?: FinancialMilestone; goals: FinancialGoal[]; events: { id: string; name: string; start_date: string | null }[]; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    title: milestone?.title ?? "",
    milestone_type: (milestone?.milestone_type ?? "life_event") as MilestoneType,
    target_date: milestone?.target_date ?? null,
    amount: milestone?.amount != null ? String(milestone.amount) : "",
    linked_goal_id: milestone?.linked_goal_id ?? null,
    linked_event_id: milestone?.linked_event_id ?? null,
    notes: milestone?.notes ?? "",
  });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = { ...form, amount: form.amount || null };
      const res = milestone ? await updateMilestone(milestone.id, payload) : await createMilestone(payload);
      if (!res.ok) return void setError(res.error);
      toast.success(milestone ? "Saved" : "Added to the timeline");
      router.refresh();
      onClose();
    });
  }
  function remove() {
    if (!milestone || !confirm(`Delete “${milestone.title}”?`)) return;
    startTransition(async () => {
      const res = await deleteMilestone(milestone.id);
      if (!res.ok) return void setError(res.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" htmlFor="ms-title" className="sm:col-span-2">
          <Input id="ms-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus placeholder="e.g. Move to Chicago" />
        </Field>
        <Field label="Type" htmlFor="ms-type">
          <NativeSelect id="ms-type" value={form.milestone_type} onChange={(e) => setForm({ ...form, milestone_type: e.target.value as MilestoneType })}>
            <option value="life_event">Life event</option>
            <option value="goal">Goal checkpoint</option>
            <option value="custom">Custom</option>
          </NativeSelect>
        </Field>
        <Field label="Date" htmlFor="ms-date">
          <DateInput id="ms-date" value={form.target_date} onChange={(v) => setForm({ ...form, target_date: v })} />
        </Field>
        <Field label="Amount (optional)" htmlFor="ms-amount" hint="What it costs or what it is worth.">
          <MoneyInput id="ms-amount" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
        </Field>
        <Field label="Linked goal" htmlFor="ms-goal">
          <NativeSelect id="ms-goal" value={form.linked_goal_id ?? ""} onChange={(e) => setForm({ ...form, linked_goal_id: e.target.value || null })}>
            <option value="">None</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Linked FradyOS event" htmlFor="ms-event" className="sm:col-span-2">
          <NativeSelect id="ms-event" value={form.linked_event_id ?? ""} onChange={(e) => setForm({ ...form, linked_event_id: e.target.value || null })}>
            <option value="">None</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
                {ev.start_date ? ` · ${formatDate(ev.start_date, "medium")}` : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Notes" htmlFor="ms-notes" className="sm:col-span-2">
          <Textarea id="ms-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        </Field>
      </div>
      <DialogFooter className="flex-row items-center justify-between sm:justify-between">
        {milestone ? (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={remove} disabled={pending}>
            <Trash2 /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null} {milestone ? "Save" : "Add"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
