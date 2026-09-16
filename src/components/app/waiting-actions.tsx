"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CheckCheck, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { markReceived, recordFollowUp, rescheduleFollowUp } from "@/actions/tasks";
import { DateInput, Field } from "./form-fields";
import { useWorkspace } from "./workspace-provider";
import { addDays } from "@/lib/dates";
import type { TaskWithRefs } from "@/lib/types";

type Mode = "followup" | "reschedule" | "received" | null;

export function WaitingActions({ task, compact = false }: { task: TaskWithRefs; compact?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>(null);
  const [pending, startTransition] = React.useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Failed");
      toast.success(success);
      setMode(null);
      router.refresh();
    });
  }

  const size = compact ? "sm" : "sm";
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size={size} onClick={() => setMode("followup")}>
          <MessageSquare /> Record follow-up
        </Button>
        <Button variant="outline" size={size} onClick={() => setMode("reschedule")}>
          <CalendarClock /> Reschedule
        </Button>
        <Button variant="outline" size={size} onClick={() => setMode("received")}>
          <CheckCheck /> Received
        </Button>
      </div>

      <Dialog open={mode === "followup"} onOpenChange={(v) => !v && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record a follow-up</DialogTitle>
            <DialogDescription>
              Logs that you followed up with {task.waiting_person ?? "them"} today. Nothing is sent automatically.
            </DialogDescription>
          </DialogHeader>
          <FollowUpForm pending={pending} onCancel={() => setMode(null)} onSave={(nextDate, note) => run(() => recordFollowUp(task.id, { next_followup_date: nextDate, note }), "Follow-up recorded")} />
        </DialogContent>
      </Dialog>

      <Dialog open={mode === "reschedule"} onOpenChange={(v) => !v && setMode(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reschedule follow-up</DialogTitle>
            <DialogDescription>Only your follow-up date changes. Their expected delivery date stays as is.</DialogDescription>
          </DialogHeader>
          <RescheduleForm initial={task.waiting_followup_date} pending={pending} onCancel={() => setMode(null)} onSave={(d) => run(() => rescheduleFollowUp(task.id, d), "Follow-up rescheduled")} />
        </DialogContent>
      </Dialog>

      <Dialog open={mode === "received"} onOpenChange={(v) => !v && setMode(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark as received</DialogTitle>
            <DialogDescription>What happens to “{task.title}” now that you have it?</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button disabled={pending} onClick={() => run(() => markReceived(task.id, "complete"), "Received and completed")}>
              Received — mark the task complete
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => run(() => markReceived(task.id, "todo"), "Received; task moved to To Do")}>
              Received — I still have work to do (move to To Do)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FollowUpForm({ pending, onCancel, onSave }: { pending: boolean; onCancel: () => void; onSave: (nextDate: string | null, note: string) => void }) {
  const { today } = useWorkspace();
  const [nextDate, setNextDate] = React.useState<string | null>(addDays(today, 3));
  const [note, setNote] = React.useState("");
  return (
    <>
      <Field label="Note (optional)">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Emailed a reminder; they said Friday." autoFocus />
      </Field>
      <Field label="Next follow-up date" hint="Leave blank to stop scheduling follow-ups.">
        <DateInput value={nextDate} onChange={setNextDate} />
      </Field>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={pending} onClick={() => onSave(nextDate, note)}>
          {pending ? <Loader2 className="animate-spin" /> : null} Save
        </Button>
      </DialogFooter>
    </>
  );
}

function RescheduleForm({ initial, pending, onCancel, onSave }: { initial: string | null; pending: boolean; onCancel: () => void; onSave: (d: string | null) => void }) {
  const { today } = useWorkspace();
  const [nextDate, setNextDate] = React.useState<string | null>(initial ?? addDays(today, 3));
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {[1, 2, 3, 7].map((n) => (
          <Button key={n} type="button" size="sm" variant={nextDate === addDays(today, n) ? "default" : "outline"} onClick={() => setNextDate(addDays(today, n))}>
            {n === 1 ? "Tomorrow" : n === 7 ? "Next week" : `In ${n} days`}
          </Button>
        ))}
      </div>
      <Field label="Follow-up date">
        <DateInput value={nextDate} onChange={setNextDate} />
      </Field>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={pending} onClick={() => onSave(nextDate)}>
          {pending ? <Loader2 className="animate-spin" /> : null} Save
        </Button>
      </DialogFooter>
    </>
  );
}
