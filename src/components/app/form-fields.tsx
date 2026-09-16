"use client";

import * as React from "react";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { Link } from "@/lib/types";
import { useWorkspace } from "./workspace-provider";

export function Field({ label, htmlFor, error, hint, className, children }: { label: React.ReactNode; htmlFor?: string; error?: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function AreaSelect({ value, onChange, id, allowNone = true, className }: { value: string | null; onChange: (v: string | null) => void; id?: string; allowNone?: boolean; className?: string }) {
  const { workAreas } = useWorkspace();
  return (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={className}>
      {allowNone ? <option value="">No work area</option> : null}
      {workAreas.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </NativeSelect>
  );
}

export function ProjectSelect({ value, onChange, id, areaId, className }: { value: string | null; onChange: (v: string | null) => void; id?: string; areaId?: string | null; className?: string }) {
  const { projects, workAreas } = useWorkspace();
  const visible = projects.filter((p) => p.status !== "completed" || p.id === value);
  const grouped = workAreas.map((a) => ({ area: a, items: visible.filter((p) => p.work_area_id === a.id) }));
  const noArea = visible.filter((p) => !p.work_area_id);
  return (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={className}>
      <option value="">No project</option>
      {grouped
        .filter((g) => g.items.length && (!areaId || g.area.id === areaId))
        .map((g) => (
          <optgroup key={g.area.id} label={g.area.name}>
            {g.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ))}
      {noArea.length && !areaId ? (
        <optgroup label="Other">
          {noArea.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </NativeSelect>
  );
}

export function LinksEditor({ value, onChange, label = "Links" }: { value: Link[]; onChange: (v: Link[]) => void; label?: string }) {
  const [draft, setDraft] = React.useState({ label: "", url: "" });
  const [err, setErr] = React.useState<string | null>(null);

  function add() {
    const url = draft.url.trim();
    if (!url) return;
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
      new URL(normalized);
    } catch {
      setErr("Enter a valid URL");
      return;
    }
    onChange([...value, { label: draft.label.trim() || hostOf(normalized), url: normalized }]);
    setDraft({ label: "", url: "" });
    setErr(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {value.length ? (
        <ul className="flex flex-col gap-1">
          {value.map((l, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="text-primary inline-flex min-w-0 flex-1 items-center gap-1 truncate hover:underline">
                <ExternalLink className="size-3.5 shrink-0" />
                <span className="truncate">{l.label || l.url}</span>
              </a>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove link" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-1.5 sm:flex-row">
        <Input placeholder="Label (optional)" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="sm:w-40" />
        <Input
          placeholder="https://…"
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={add} className="sm:h-9">
          <Plus /> Add
        </Button>
      </div>
      {err ? <p className="text-destructive text-xs">{err}</p> : null}
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function DateInput({ value, onChange, id, className, ...props }: { value: string | null; onChange: (v: string | null) => void; id?: string; className?: string } & Omit<React.ComponentProps<"input">, "value" | "onChange" | "type">) {
  return <Input id={id} type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={cn("tabular-nums", className)} {...props} />;
}

export function TimeInput({ value, onChange, id, className, ...props }: { value: string | null; onChange: (v: string | null) => void; id?: string; className?: string } & Omit<React.ComponentProps<"input">, "value" | "onChange" | "type">) {
  return <Input id={id} type="time" value={value ? value.slice(0, 5) : ""} onChange={(e) => onChange(e.target.value || null)} className={cn("tabular-nums", className)} {...props} />;
}
