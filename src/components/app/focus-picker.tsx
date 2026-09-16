"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { setFocus } from "@/actions/tasks";
import { listOpenTasksForPicker } from "@/actions/task-lists";
import type { TaskWithRefs } from "@/lib/types";
import { useWorkspace } from "./workspace-provider";
import { dueLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function FocusPicker({ open, onOpenChange, current }: { open: boolean; onOpenChange: (v: boolean) => void; current: string[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose today&apos;s top priorities</DialogTitle>
          <DialogDescription>Pick up to three open tasks. Order of selection sets the rank.</DialogDescription>
        </DialogHeader>
        <FocusPickerBody current={current} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function FocusPickerBody({ current, onClose }: { current: string[]; onClose: () => void }) {
  const router = useRouter();
  const { today } = useWorkspace();
  const [state, setState] = React.useState<{ loading: boolean; tasks: TaskWithRefs[] }>({ loading: true, tasks: [] });
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>(current);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    let cancelled = false;
    listOpenTasksForPicker().then((res) => {
      if (cancelled) return;
      if (res.ok) setState({ loading: false, tasks: res.data });
      else {
        setState({ loading: false, tasks: [] });
        toast.error(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = state.tasks.filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()) || t.project?.name.toLowerCase().includes(q.toLowerCase()));

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? s : [...s, id]));
  }

  function save() {
    startTransition(async () => {
      const res = await setFocus(selected);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Priorities updated");
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      <div className="relative">
        <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tasks…" className="pl-8" autoFocus />
      </div>
      <div className="max-h-[50vh] overflow-y-auto rounded-md border">
        {state.loading ? (
          <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading tasks…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">No open tasks match.</p>
        ) : (
          <ul className="divide-y">
            {filtered.map((t) => {
              const idx = selected.indexOf(t.id);
              const checked = idx >= 0;
              const disabled = !checked && selected.length >= 3;
              return (
                <li key={t.id}>
                  <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/40", disabled && "opacity-50")}>
                    <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggle(t.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {[t.project?.name, t.work_area?.name, t.due_date ? dueLabel(t.due_date, today) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {checked ? <span className="text-muted-foreground text-xs font-semibold tabular-nums">#{idx + 1}</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => setSelected([])}>
          Clear
        </Button>
        <Button onClick={save} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} Save priorities
        </Button>
      </DialogFooter>
    </>
  );
}
