"use client";

import * as React from "react";
import { toast } from "sonner";
import { Paperclip, Plus, Trash2, Download, Loader2, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { addSubtask, deleteSubtask, toggleSubtask } from "@/actions/tasks";
import { addNote, deleteNote, type NoteParent } from "@/actions/notes";
import { deleteAttachment, getAttachmentUrl, registerAttachment } from "@/actions/attachments";
import { createClient } from "@/lib/supabase/client";
import type { Attachment, Note, Subtask } from "@/lib/types";
import { formatTimestamp } from "@/lib/dates";
import { useWorkspace } from "./workspace-provider";
import { cn } from "@/lib/utils";

export function SubtasksList({ taskId, subtasks, onChanged }: { taskId: string; subtasks: Subtask[]; onChanged: () => void }) {
  const [title, setTitle] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [local, setLocal] = React.useState(subtasks);
  const [prevSubtasks, setPrevSubtasks] = React.useState(subtasks);
  if (prevSubtasks !== subtasks) {
    setPrevSubtasks(subtasks);
    setLocal(subtasks);
  }

  function add() {
    const t = title.trim();
    if (!t) return;
    startTransition(async () => {
      const res = await addSubtask(taskId, t);
      if (!res.ok) return void toast.error(res.error);
      setTitle("");
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {local.map((s) => (
        <div key={s.id} className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent/40">
          <Checkbox
            checked={s.is_done}
            onCheckedChange={(v) => {
              const done = v === true;
              setLocal((xs) => xs.map((x) => (x.id === s.id ? { ...x, is_done: done } : x)));
              startTransition(async () => {
                const res = await toggleSubtask(s.id, done);
                if (!res.ok) toast.error(res.error);
                else onChanged();
              });
            }}
            aria-label={s.title}
          />
          <span className={cn("flex-1 text-sm", s.is_done && "text-muted-foreground line-through")}>{s.title}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="Delete subtask"
            onClick={() =>
              startTransition(async () => {
                const res = await deleteSubtask(s.id);
                if (!res.ok) toast.error(res.error);
                else onChanged();
              })
            }
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a subtask and press Enter"
          className="h-8"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={pending || !title.trim()}>
          <Plus /> Add
        </Button>
      </div>
    </div>
  );
}

export function NotesList({ parent, notes, onChanged }: { parent: NoteParent; notes: Note[]; onChanged: () => void }) {
  const { timezone } = useWorkspace();
  const [body, setBody] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function add() {
    if (!body.trim()) return;
    startTransition(async () => {
      const res = await addNote(parent, body);
      if (!res.ok) return void toast.error(res.error);
      setBody("");
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note… (⌘/Ctrl+Enter to save)" rows={2}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={add} disabled={pending || !body.trim()}>
            <StickyNote /> Save note
          </Button>
        </div>
      </div>
      {notes.length ? (
        <ul className="flex flex-col gap-1.5">
          {notes.map((n) => (
            <li key={n.id} className="group rounded-md border px-2.5 py-2">
              <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground text-[11px]">{formatTimestamp(n.created_at, timezone, { withYear: true })}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Delete note"
                  onClick={() =>
                    startTransition(async () => {
                      const res = await deleteNote(n.id);
                      if (!res.ok) toast.error(res.error);
                      else onChanged();
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AttachmentsList({ parent, attachments, onChanged }: { parent: NoteParent; attachments: Attachment[]; onChanged: () => void }) {
  const { userId } = useWorkspace();
  const [uploading, setUploading] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const supabase = createClient();
      const parentKey = Object.keys(parent)[0];
      const parentId = Object.values(parent)[0];
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`${file.name} is larger than 25 MB`);
          continue;
        }
        const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
        const path = `${userId}/${parentKey.replace("_id", "")}/${parentId}/${crypto.randomUUID()}-${safe}`;
        const { error } = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (error) {
          toast.error(`Upload failed: ${error.message}`);
          continue;
        }
        const res = await registerAttachment({ ...parent, storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size });
        if (!res.ok) toast.error(res.error);
      }
      onChanged();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {attachments.length ? (
        <ul className="flex flex-col gap-1">
          {attachments.map((a) => (
            <li key={a.id} className="group flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <Paperclip className="text-muted-foreground size-3.5 shrink-0" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left hover:underline"
                onClick={() =>
                  startTransition(async () => {
                    const res = await getAttachmentUrl(a.id);
                    if (!res.ok) return void toast.error(res.error);
                    window.open(res.data.url, "_blank", "noopener");
                  })
                }
              >
                {a.file_name}
              </button>
              <span className="text-muted-foreground text-xs tabular-nums">{a.size_bytes ? formatBytes(a.size_bytes) : ""}</span>
              <Button variant="ghost" size="icon-xs" aria-label="Download" onClick={() => startTransition(async () => { const r = await getAttachmentUrl(a.id); if (r.ok) window.open(r.data.url, "_blank", "noopener"); else toast.error(r.error); })}>
                <Download />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label="Delete attachment"
                onClick={() =>
                  startTransition(async () => {
                    const res = await deleteAttachment(a.id);
                    if (!res.ok) toast.error(res.error);
                    else onChanged();
                  })
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="file" multiple className="sr-only" id={`file-${Object.values(parent)[0]}`} onChange={(e) => upload(e.target.files)} />
        <Button type="button" variant="outline" size="sm" disabled={uploading || pending} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />} {uploading ? "Uploading…" : "Attach files"}
        </Button>
        <span className="text-muted-foreground text-xs">Stored privately in Supabase Storage (max 25 MB each).</span>
      </div>
    </div>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
