"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Trash2, Send, ExternalLink, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { deleteSocialPost, markPostPublished, updateSocialPost } from "@/actions/social";
import type { SocialPostDetail } from "@/lib/data/social";
import { PLATFORMS, SOCIAL_STATUSES, type Link as LinkT, type Platform, type SocialStatus } from "@/lib/types";
import { formatDate, formatTimestamp } from "@/lib/dates";
import { AreaSelect, DateInput, Field, LinksEditor, ProjectSelect, TimeInput } from "./form-fields";
import { AttachmentsList, NotesList } from "./detail-parts";
import { useWorkspace } from "./workspace-provider";
import { SocialStatusBadge, DueBadge, nextSocialMilestone } from "./items";

type Form = {
  title: string;
  status: SocialStatus;
  platform: Platform | null;
  brand: string;
  work_area_id: string | null;
  project_id: string | null;
  draft_due_date: string | null;
  approval_due_date: string | null;
  publish_date: string | null;
  publish_time: string | null;
  approver: string;
  followup_date: string | null;
  caption: string;
  assets: LinkT[];
  published_url: string;
  notes: string;
};

export function SocialPostEditor({ detail, onChanged, onClose }: { detail: SocialPostDetail; onChanged: () => void; onClose: () => void }) {
  const { today, timezone } = useWorkspace();
  const p = detail.post;
  const [form, setForm] = React.useState<Form>({
    title: p.title,
    status: p.status,
    platform: p.platform,
    brand: p.brand ?? "",
    work_area_id: p.work_area_id,
    project_id: p.project_id,
    draft_due_date: p.draft_due_date,
    approval_due_date: p.approval_due_date,
    publish_date: p.publish_date,
    publish_time: p.publish_time,
    approver: p.approver ?? "",
    followup_date: p.followup_date,
    caption: p.caption ?? "",
    assets: p.assets ?? [],
    published_url: p.published_url ?? "",
    notes: p.notes ?? "",
  });
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  }

  const linkedinHashtags = form.platform === "linkedin" && /(^|\s)#\w+/.test(form.caption);

  function save() {
    if (!form.title.trim()) return setError("Give the post a title");
    setError(null);
    startTransition(async () => {
      const res = await updateSocialPost(p.id, {
        title: form.title,
        status: form.status,
        platform: form.platform,
        brand: form.brand || null,
        work_area_id: form.work_area_id,
        project_id: form.project_id,
        draft_due_date: form.draft_due_date,
        approval_due_date: form.approval_due_date,
        publish_date: form.publish_date,
        publish_time: form.publish_time,
        approver: form.approver || null,
        followup_date: form.followup_date,
        caption: form.caption || null,
        assets: form.assets,
        published_url: form.published_url || null,
        notes: form.notes || null,
      });
      if (!res.ok) return setError(res.error);
      setDirty(false);
      toast.success("Saved");
      onChanged();
    });
  }

  function publish() {
    const url = window.prompt("Published post URL (optional):", form.published_url || "") ?? undefined;
    startTransition(async () => {
      const res = await markPostPublished(p.id, url || null);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Marked as published");
      onChanged();
    });
  }

  function remove() {
    if (!window.confirm("Delete this social post?")) return;
    startTransition(async () => {
      const res = await deleteSocialPost(p.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Post deleted");
      onClose();
    });
  }

  const next = nextSocialMilestone(p, today);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur">
        <SocialStatusBadge status={p.status} />
        {next && p.status !== "published" ? <DueBadge date={next.date} today={today} label={next.label} /> : null}
        <div className="ml-auto flex items-center gap-1">
          {p.status !== "published" ? (
            <Button variant="outline" size="sm" onClick={publish} disabled={pending}>
              <Send /> Mark published
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} className="h-10 text-base font-medium" aria-label="Title" />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Status" hint={form.status === "scheduled" ? "Scheduled = a publish date is recorded here. Nothing is published automatically." : undefined} className={form.status === "scheduled" ? "col-span-2 sm:col-span-4" : ""}>
            <NativeSelect value={form.status} onChange={(e) => set("status", e.target.value as SocialStatus)}>
              {SOCIAL_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Platform">
            <NativeSelect value={form.platform ?? ""} onChange={(e) => set("platform", (e.target.value || null) as Platform | null)}>
              <option value="">Choose…</option>
              {PLATFORMS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Brand / account">
            <Input value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="e.g. ARI main" />
          </Field>
          <Field label="Work area">
            <AreaSelect value={form.work_area_id} onChange={(v) => set("work_area_id", v)} />
          </Field>
          <Field label="Project">
            <ProjectSelect value={form.project_id} onChange={(v) => set("project_id", v)} />
          </Field>
        </div>

        {p.event ? (
          <p className="text-muted-foreground text-xs">
            Event:{" "}
            <Link href={`/events/${p.event.id}`} className="text-primary hover:underline">
              {p.event.name}
            </Link>
            {p.event.start_date ? ` · ${formatDate(p.event.start_date, "medium", today)}` : ""}
            {p.template_item_id ? (p.date_overridden ? " · dates manually overridden" : " · dates follow the event via template") : ""}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Draft deadline">
            <DateInput value={form.draft_due_date} onChange={(v) => set("draft_due_date", v)} />
          </Field>
          <Field label="Approval deadline">
            <DateInput value={form.approval_due_date} onChange={(v) => set("approval_due_date", v)} />
          </Field>
          <Field label="Publish date">
            <DateInput value={form.publish_date} onChange={(v) => set("publish_date", v)} />
          </Field>
          <Field label="Publish time">
            <TimeInput value={form.publish_time} onChange={(v) => set("publish_time", v)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Approver">
            <Input value={form.approver} onChange={(e) => set("approver", e.target.value)} placeholder="Who signs off" />
          </Field>
          <Field label="Approval follow-up date">
            <DateInput value={form.followup_date} onChange={(v) => set("followup_date", v)} />
          </Field>
        </div>

        <Field label="Caption draft" hint={form.platform === "linkedin" ? "LinkedIn drafts: keep it hashtag-free." : undefined}>
          <Textarea value={form.caption} onChange={(e) => set("caption", e.target.value)} rows={6} placeholder="Write the caption…" />
        </Field>
        {linkedinHashtags ? (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertDescription>This LinkedIn draft contains hashtags. Remove them before approval.</AlertDescription>
          </Alert>
        ) : null}
        <p className="text-muted-foreground -mt-2 text-xs tabular-nums">{form.caption.length} characters</p>

        <LinksEditor label="Creative assets and links" value={form.assets} onChange={(v) => set("assets", v)} />

        <Field label="Published post URL">
          <div className="flex items-center gap-2">
            <Input value={form.published_url} onChange={(e) => set("published_url", e.target.value)} placeholder="https://…" />
            {p.published_url ? (
              <Button asChild variant="outline" size="icon" aria-label="Open published post">
                <a href={p.published_url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink />
                </a>
              </Button>
            ) : null}
          </div>
        </Field>

        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
        </Field>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={remove} disabled={pending}>
            <Trash2 /> Delete
          </Button>
          <div className="flex items-center gap-2">
            {dirty ? <span className="text-muted-foreground text-xs">Unsaved changes</span> : null}
            <Button onClick={save} disabled={pending || !dirty}>
              {pending ? <Loader2 className="animate-spin" /> : null} Save
            </Button>
          </div>
        </div>

        <Separator />
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h3>
          <NotesList parent={{ social_post_id: p.id }} notes={detail.notes} onChanged={onChanged} />
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attachments</h3>
          <AttachmentsList parent={{ social_post_id: p.id }} attachments={detail.attachments} onChanged={onChanged} />
        </section>
        <p className="text-muted-foreground text-xs">
          Created {formatTimestamp(p.created_at, timezone, { withYear: true })}
          {p.published_at ? ` · Published ${formatTimestamp(p.published_at, timezone, { withYear: true })}` : ""}
        </p>
      </div>
    </div>
  );
}
