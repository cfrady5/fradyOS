"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Megaphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createSocialPost } from "@/actions/social";
import { PLATFORMS, SOCIAL_STATUSES, type Platform, type SocialStatus } from "@/lib/types";
import { AreaSelect, DateInput, Field, ProjectSelect, TimeInput } from "./form-fields";
import { useOpenItem } from "@/hooks/use-open-item";
import type { VariantProps } from "class-variance-authority";

export type SocialPreset = { project_id?: string | null; work_area_id?: string | null; event_id?: string | null; publish_date?: string | null; title?: string };

export function NewSocialPostButton({ preset, size = "sm", variant = "outline", label = "New post" }: { preset?: SocialPreset; size?: VariantProps<typeof buttonVariants>["size"]; variant?: VariantProps<typeof buttonVariants>["variant"]; label?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <Megaphone /> {label}
      </Button>
      <NewSocialPostDialog open={open} onOpenChange={setOpen} preset={preset} />
    </>
  );
}

export function NewSocialPostDialog({ open, onOpenChange, preset }: { open: boolean; onOpenChange: (v: boolean) => void; preset?: SocialPreset }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New social post</DialogTitle>
          <DialogDescription>One record that shows up on the dashboard, event page, task views and calendar.</DialogDescription>
        </DialogHeader>
        <NewSocialPostForm preset={preset} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewSocialPostForm({ preset, onClose }: { preset?: SocialPreset; onClose: () => void }) {
  const router = useRouter();
  const { openPost } = useOpenItem();
  const [form, setForm] = React.useState({
    title: preset?.title ?? "",
    platform: "" as Platform | "",
    brand: "",
    status: "idea" as SocialStatus,
    work_area_id: preset?.work_area_id ?? null,
    project_id: preset?.project_id ?? null,
    draft_due_date: null as string | null,
    approval_due_date: null as string | null,
    publish_date: preset?.publish_date ?? null,
    publish_time: null as string | null,
  });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createSocialPost({
        ...form,
        platform: form.platform || null,
        brand: form.brand || null,
        event_id: preset?.event_id ?? null,
      });
      if (!res.ok) return setError(res.error);
      toast.success("Post created", { action: { label: "Open", onClick: () => openPost(res.data.id) } });
      onClose();
      router.refresh();
    });
  }

  return (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus placeholder="e.g. Two-weeks-out promotion" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Platform">
              <NativeSelect value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as Platform | "" })}>
                <option value="">Choose…</option>
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Brand / account">
              <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </Field>
            <Field label="Status">
              <NativeSelect value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SocialStatus })}>
                {SOCIAL_STATUSES.filter((s) => s.value !== "published").map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Work area">
              <AreaSelect value={form.work_area_id} onChange={(v) => setForm({ ...form, work_area_id: v })} />
            </Field>
            <Field label="Project" className="col-span-2">
              <ProjectSelect value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Draft due">
              <DateInput value={form.draft_due_date} onChange={(v) => setForm({ ...form, draft_due_date: v })} />
            </Field>
            <Field label="Approval due">
              <DateInput value={form.approval_due_date} onChange={(v) => setForm({ ...form, approval_due_date: v })} />
            </Field>
            <Field label="Publish date">
              <DateInput value={form.publish_date} onChange={(v) => setForm({ ...form, publish_date: v })} />
            </Field>
            <Field label="Time">
              <TimeInput value={form.publish_time} onChange={(v) => setForm({ ...form, publish_time: v })} />
            </Field>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} Create post
            </Button>
          </DialogFooter>
        </form>
  );
}
