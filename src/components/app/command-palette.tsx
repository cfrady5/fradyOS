"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderKanban, CheckSquare, CalendarDays, Megaphone, Plus, Loader2 } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { searchWorkspace, type SearchHit } from "@/actions/search";
import { NAV_ITEMS } from "./nav";
import { useOpenItem } from "@/hooks/use-open-item";
import { useShell } from "./app-shell";
import { formatDate } from "@/lib/dates";
import { useWorkspace } from "./workspace-provider";

const ICONS = { project: FolderKanban, task: CheckSquare, event: CalendarDays, social: Megaphone } as const;
const LABELS = { project: "Projects", task: "Tasks", event: "Events", social: "Social posts" } as const;

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search projects, tasks, events and social posts" shouldFilter={false}>
      {/* Body mounts fresh on every open, so query and results reset naturally. */}
      <PaletteBody onClose={() => onOpenChange(false)} />
    </CommandDialog>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { openTask, openPost } = useOpenItem();
  const { openQuickAdd } = useShell();
  const { today } = useWorkspace();
  const [query, setQuery] = React.useState("");
  const [result, setResult] = React.useState<{ q: string; hits: SearchHit[]; error: string | null } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const q = query.trim();
  const tooShort = q.length < 2;

  React.useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await searchWorkspace(q);
      if (cancelled) return;
      setLoading(false);
      setResult(res.ok ? { q, hits: res.data, error: null } : { q, hits: [], error: res.error });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const hits = !tooShort && result && result.q === q ? result.hits : [];
  const error = !tooShort && result && result.q === q ? result.error : null;
  const searching = !tooShort && (loading || !result || result.q !== q);

  function go(hit: SearchHit) {
    onClose();
    if (hit.kind === "project") router.push(`/projects/${hit.id}`);
    else if (hit.kind === "event") router.push(`/events/${hit.id}`);
    else if (hit.kind === "task") openTask(hit.id);
    else openPost(hit.id);
  }

  const groups = (["task", "project", "event", "social"] as const).map((k) => ({ kind: k, items: hits.filter((h) => h.kind === k) }));

  return (
    <>
      <CommandInput placeholder="Search projects, tasks, events, posts…" value={query} onValueChange={setQuery} />
      <CommandList>
        {searching ? (
          <div className="text-muted-foreground flex items-center gap-2 px-3 py-4 text-sm">
            <Loader2 className="size-4 animate-spin" /> Searching…
          </div>
        ) : null}
        {error ? <div className="text-destructive px-3 py-3 text-sm">{error}</div> : null}
        {!searching && !tooShort && hits.length === 0 && !error ? <CommandEmpty>No matches for “{q}”.</CommandEmpty> : null}
        {groups
          .filter((g) => g.items.length)
          .map((g) => {
            const Icon = ICONS[g.kind];
            return (
              <CommandGroup key={g.kind} heading={LABELS[g.kind]}>
                {g.items.map((h) => (
                  <CommandItem key={`${h.kind}-${h.id}`} value={`${h.kind}-${h.id}`} onSelect={() => go(h)}>
                    <Icon />
                    <span className="min-w-0 flex-1 truncate">{h.title}</span>
                    {h.subtitle ? <span className="text-muted-foreground max-w-[40%] truncate text-xs">{h.subtitle}</span> : null}
                    {h.date_hint ? <span className="text-muted-foreground text-xs tabular-nums">{formatDate(h.date_hint, "short", today)}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        {tooShort ? (
          <>
            <CommandGroup heading="Actions">
              <CommandItem value="new-task" onSelect={() => { onClose(); openQuickAdd({ title: q || undefined }); }}>
                <Plus /> New task
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Go to">
              {NAV_ITEMS.map((n) => (
                <CommandItem key={n.href} value={`nav-${n.href}`} onSelect={() => { onClose(); router.push(n.href); }}>
                  <n.icon /> {n.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem value="new-task-with-title" onSelect={() => { onClose(); openQuickAdd({ title: q }); }}>
                <Plus /> Create task “{q}”
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </>
  );
}
