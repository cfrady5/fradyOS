"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AreaTag, PageHeader } from "@/components/app/items";
import { Field } from "@/components/app/form-fields";
import { updateProfile } from "@/actions/settings";
import { createWorkArea, deleteWorkArea, reorderWorkAreas, updateWorkArea } from "@/actions/work-areas";
import type { EventTemplate, EventTemplateItem, MondayConnection, MondaySyncRun, Profile, WorkArea } from "@/lib/types";
import { MondaySettings } from "@/components/app/monday-settings";
import { TemplatesSettings } from "@/components/app/templates-settings";
import { cn } from "@/lib/utils";

const TIMEZONES = [
  "America/Indiana/Indianapolis",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

export function SettingsView(props: {
  tab: string;
  profile: Profile;
  workAreas: WorkArea[];
  email: string | null;
  monday: { tokenConfigured: boolean; connections: { events: MondayConnection | null; social: MondayConnection | null }; runs: MondaySyncRun[]; webhookUrl: string | null; excludedCount: number };
  emailConfigured: boolean;
  adminConfigured: boolean;
  cronConfigured: boolean;
  templates: EventTemplate[];
  templateItems: EventTemplateItem[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Workspace preferences, work areas, integrations and reminders." />
      <Tabs value={props.tab} onValueChange={(v) => router.push(`${pathname}?tab=${v}`)}>
        <TabsList className="h-auto flex-wrap" aria-label="Settings sections">
          <TabsTrigger value="general" className="h-7 flex-none">General</TabsTrigger>
          <TabsTrigger value="areas" className="h-7 flex-none">Work areas</TabsTrigger>
          <TabsTrigger value="monday" className="h-7 flex-none">Monday.com</TabsTrigger>
          <TabsTrigger value="templates" className="h-7 flex-none">Event templates</TabsTrigger>
          <TabsTrigger value="reminders" className="h-7 flex-none">Reminders</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GeneralSettings profile={props.profile} email={props.email} />
        </TabsContent>
        <TabsContent value="areas">
          <WorkAreasSettings key={props.workAreas.map((a) => a.id).join(",")} workAreas={props.workAreas} />
        </TabsContent>
        <TabsContent value="monday">
          <MondaySettings tokenConfigured={props.monday.tokenConfigured} connections={props.monday.connections} runs={props.monday.runs} webhookUrl={props.monday.webhookUrl} cronConfigured={props.cronConfigured} adminConfigured={props.adminConfigured} workAreas={props.workAreas} excludedCount={props.monday.excludedCount} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesSettings templates={props.templates} items={props.templateItems} />
        </TabsContent>
        <TabsContent value="reminders">
          <ReminderSettings profile={props.profile} emailConfigured={props.emailConfigured} cronConfigured={props.cronConfigured} adminConfigured={props.adminConfigured} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralSettings({ profile, email }: { profile: Profile; email: string | null }) {
  const router = useRouter();
  const [form, setForm] = React.useState({ display_name: profile.display_name ?? "", timezone: profile.timezone, week_starts_on: profile.week_starts_on });
  const [pending, startTransition] = React.useTransition();
  const tzOptions = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Profile</CardTitle>
          <CardDescription className="mt-1">Signed in as {email ?? "—"}.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Display name">
            <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </Field>
          <Field label="Time zone" hint="All deadlines and “today” use this zone.">
            <NativeSelect value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {tzOptions.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Week starts on">
            <NativeSelect value={String(form.week_starts_on)} onChange={(e) => setForm({ ...form, week_starts_on: Number(e.target.value) as 0 | 1 })}>
              <option value="1">Monday</option>
              <option value="0">Sunday</option>
            </NativeSelect>
          </Field>
        </div>
        <div>
          <Button
            loading={pending}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await updateProfile({ display_name: form.display_name || null, timezone: form.timezone, week_starts_on: form.week_starts_on });
                if (!res.ok) return void toast.error(res.error);
                toast.success("Saved");
                router.refresh();
              })
            }
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkAreasSettings({ workAreas }: { workAreas: WorkArea[] }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState("#2563eb");
  const [pending, startTransition] = React.useTransition();
  const [order, setOrder] = React.useState(() => workAreas.map((a) => a.id));
  const sorted = order.map((id) => workAreas.find((a) => a.id === id)!).filter(Boolean);

  function moveItem(from: number, to: number) {
    const next = [...order];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setOrder(next);
    startTransition(async () => {
      const res = await reorderWorkAreas(next);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Work areas</CardTitle>
          <CardDescription className="mt-1">Group projects, tasks and events by the hats you wear. Rename, recolor, reorder or archive.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="hairline-rows border-line-1 rounded-md border">
          {sorted.map((a, i) => (
            <WorkAreaRow key={a.id} area={a} index={i} total={sorted.length} onMove={moveItem} />
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await createWorkArea({ name, color });
              if (!res.ok) return void toast.error(res.error);
              setName("");
              toast.success("Work area added");
              router.refresh();
            });
          }}
        >
          <Field label="New work area">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Consulting" className="w-56" />
          </Field>
          <Field label="Color">
            <ColorField value={color} onChange={setColor} label="New work area color" />
          </Field>
          <Button type="submit" disabled={pending || !name.trim()}>
            <Plus /> Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function WorkAreaRow({ area, index, total, onMove }: { area: WorkArea; index: number; total: number; onMove: (from: number, to: number) => void }) {
  const router = useRouter();
  const [name, setName] = React.useState(area.name);
  const [color, setColor] = React.useState(area.color);
  const [pending, startTransition] = React.useTransition();
  const dirty = name !== area.name || color !== area.color;
  return (
    <li className="flex flex-wrap items-center gap-2 px-2 py-2">
      <div className="flex flex-col">
        <button type="button" className="text-text-3 hover:text-text-1 focus-visible:ring-brand/40 flex size-5 items-center justify-center rounded-sm outline-none focus-visible:ring-2 disabled:opacity-30" disabled={index === 0} aria-label={`Move ${area.name} up`} onClick={() => onMove(index, index - 1)}><ChevronUp className="size-3.5" /></button>
        <button type="button" className="text-text-3 hover:text-text-1 focus-visible:ring-brand/40 flex size-5 items-center justify-center rounded-sm outline-none focus-visible:ring-2 disabled:opacity-30" disabled={index === total - 1} aria-label={`Move ${area.name} down`} onClick={() => onMove(index, index + 1)}><ChevronDown className="size-3.5" /></button>
      </div>
      <ColorField value={color} onChange={setColor} label={`${area.name} color`} />
      <Input value={name} onChange={(e) => setName(e.target.value)} className="w-48" aria-label="Work area name" />
      <AreaTag name={name || area.name} color={color} className="text-meta" />
      {area.is_archived ? <span className="index">Archived</span> : null}
      <div className="ml-auto flex items-center gap-1">
        {dirty ? (
          <Button size="sm" loading={pending} disabled={pending} onClick={() => startTransition(async () => { const r = await updateWorkArea(area.id, { name, color }); if (!r.ok) toast.error(r.error); else { toast.success("Saved"); router.refresh(); } })}>
            {pending ? null : <Check />} Save
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { const r = await updateWorkArea(area.id, { is_archived: !area.is_archived }); if (!r.ok) toast.error(r.error); else router.refresh(); })}>
          {area.is_archived ? "Restore" : "Archive"}
        </Button>
        <Button size="icon-sm" variant="ghost" className="text-danger hover:text-danger" aria-label={`Delete ${area.name}`} disabled={pending} onClick={() => { if (!window.confirm(`Delete “${area.name}”? Projects and tasks keep their data but lose this label.`)) return; startTransition(async () => { const r = await deleteWorkArea(area.id); if (!r.ok) toast.error(r.error); else { toast.success("Deleted"); router.refresh(); } }); }}>
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function ReminderSettings({ profile, emailConfigured, cronConfigured, adminConfigured }: { profile: Profile; emailConfigured: boolean; cronConfigured: boolean; adminConfigured: boolean }) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    reminder_days_before_due: profile.reminder_days_before_due,
    reminder_days_before_social: profile.reminder_days_before_social,
    reminder_days_before_event: profile.reminder_days_before_event,
    email_reminders_enabled: profile.email_reminders_enabled,
  });
  const [pending, startTransition] = React.useTransition();
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>In-app reminders</CardTitle>
            <CardDescription className="mt-1">Reminders appear in the bell menu. Each reminder is created once per item and date, so nothing repeats.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Task deadlines: remind days before">
              <Input type="number" min={0} max={30} value={form.reminder_days_before_due} onChange={(e) => setForm({ ...form, reminder_days_before_due: Number(e.target.value) })} />
            </Field>
            <Field label="Social milestones: remind days before">
              <Input type="number" min={0} max={30} value={form.reminder_days_before_social} onChange={(e) => setForm({ ...form, reminder_days_before_social: Number(e.target.value) })} />
            </Field>
            <Field label="Events: remind days before">
              <Input type="number" min={0} max={60} value={form.reminder_days_before_event} onChange={(e) => setForm({ ...form, reminder_days_before_event: Number(e.target.value) })} />
            </Field>
          </div>
          <p className="text-text-3 text-meta">Overdue tasks, follow-ups due today, late deliveries and flagged events are always included.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Email reminders</CardTitle>
            <CardDescription className="mt-1">A daily digest of the same reminders, sent by the scheduled job.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!emailConfigured ? (
            <Alert variant="warning">
              <AlertTitle>Email service not configured</AlertTitle>
              <AlertDescription>
                Set <code>RESEND_API_KEY</code> and <code>REMINDER_FROM_EMAIL</code> on the server to enable email digests. Until then, reminders are in-app only.
              </AlertDescription>
            </Alert>
          ) : null}
          {!cronConfigured || !adminConfigured ? (
            <Alert variant="warning">
              <AlertTitle>Scheduled job not fully configured</AlertTitle>
              <AlertDescription>
                Email digests run from <code>/api/cron/reminders</code>, which needs <code>CRON_SECRET</code> and <code>SUPABASE_SECRET_KEY</code>. See the README.
              </AlertDescription>
            </Alert>
          ) : null}
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={form.email_reminders_enabled} disabled={!emailConfigured} onCheckedChange={(v) => setForm({ ...form, email_reminders_enabled: v })} />
            Send me a daily email digest {emailConfigured ? "" : "(unavailable until email is connected)"}
          </label>
        </CardContent>
      </Card>
      <div>
        <Button
          loading={pending}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await updateProfile(form);
              if (!res.ok) return void toast.error(res.error);
              toast.success("Reminder settings saved");
              router.refresh();
            })
          }
        >
          Save reminder settings
        </Button>
      </div>
    </div>
  );
}

const AREA_PRESETS: { name: string; color: string }[] = [
  { name: "ARI", color: "#4f8cff" },
  { name: "Northwestern Mutual", color: "#2fb59b" },
  { name: "Personal", color: "#b08cff" },
];

/** Colour picker with the three brand presets as swatches. Picking a swatch only changes the field. */
function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      {AREA_PRESETS.map((p) => (
        <button
          key={p.color}
          type="button"
          title={p.name}
          aria-label={`${p.name} preset`}
          aria-pressed={value.toLowerCase() === p.color}
          onClick={() => onChange(p.color)}
          className={cn("focus-visible:ring-brand/40 flex size-6 items-center justify-center rounded-full border border-transparent outline-none transition-transform hover:scale-110 focus-visible:ring-2 aria-pressed:border-white/70")}
          style={{ backgroundColor: p.color }}
        >
          {value.toLowerCase() === p.color ? <Check className="size-3 text-white" strokeWidth={3} aria-hidden /> : null}
        </button>
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="border-line-2 hover:border-line-3 h-7 w-9 cursor-pointer rounded-md border bg-transparent p-0.5" aria-label={`${label} (custom)`} />
    </div>
  );
}
