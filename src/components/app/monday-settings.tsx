"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw, Plug, Unplug, CheckCircle2, AlertTriangle, ExternalLink, Copy, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field } from "@/components/app/form-fields";
import { disconnectMonday, inspectMondayBoard, listMondayBoards, registerMondayWebhooks, removeMondayWebhooks, saveMondayConnection, setMondayAutoSync, syncMondayNow, testMondayConnection } from "@/actions/monday";
import type { MondayBoardSchema, MondayBoardSummary } from "@/lib/monday/client";
import { FIELD_COLUMN_TYPES, FIELD_LABELS, NAME_COLUMN } from "@/lib/monday/mapping";
import type { MondayColumnMap, MondayConnection, MondaySyncRun, WorkArea } from "@/lib/types";
import { formatTimestamp, timeAgo } from "@/lib/dates";
import { useWorkspace } from "./workspace-provider";

const FIELD_ORDER: (keyof MondayColumnMap)[] = ["name", "start", "end", "location", "program", "owner", "status", "website", "notes"];

export function MondaySettings({ tokenConfigured, connection, runs, webhookUrl, cronConfigured, adminConfigured, workAreas }: { tokenConfigured: boolean; connection: MondayConnection | null; runs: MondaySyncRun[]; webhookUrl: string | null; cronConfigured: boolean; adminConfigured: boolean; workAreas: WorkArea[] }) {
  const router = useRouter();
  const { timezone } = useWorkspace();
  const [pending, startTransition] = React.useTransition();
  const [me, setMe] = React.useState<{ name: string; account: string | null } | null>(null);
  const [boards, setBoards] = React.useState<MondayBoardSummary[] | null>(null);
  const [boardId, setBoardId] = React.useState<string>(connection?.board_id ?? "");
  const [schema, setSchema] = React.useState<MondayBoardSchema | null>(null);
  const [map, setMap] = React.useState<MondayColumnMap>(connection?.column_map ?? { name: NAME_COLUMN });
  const [canceled, setCanceled] = React.useState((connection?.canceled_labels ?? ["canceled", "cancelled"]).join(", "));
  const [editing, setEditing] = React.useState(!connection);
  const [error, setError] = React.useState<string | null>(null);

  function test() {
    startTransition(async () => {
      const res = await testMondayConnection();
      if (!res.ok) return void setError(res.error);
      setError(null);
      setMe({ name: res.data.name, account: res.data.account?.name ?? null });
      const b = await listMondayBoards();
      if (!b.ok) return void setError(b.error);
      setBoards(b.data);
    });
  }

  function inspect(id: string) {
    setBoardId(id);
    setSchema(null);
    if (!id) return;
    startTransition(async () => {
      const res = await inspectMondayBoard(id);
      if (!res.ok) return void setError(res.error);
      setError(null);
      setSchema(res.data);
      // Auto-suggest a mapping from column types/titles when starting fresh.
      if (!connection || connection.board_id !== id) setMap(suggestMapping(res.data));
    });
  }

  function save() {
    if (!boardId) return setError("Choose a board first.");
    if (!map.start) return setError("Map the start date column.");
    startTransition(async () => {
      const board = boards?.find((b) => b.id === boardId);
      const res = await saveMondayConnection({
        board_id: boardId,
        board_name: schema?.name ?? board?.name ?? connection?.board_name ?? null,
        column_map: map,
        columns_snapshot: (schema?.columns ?? connection?.columns_snapshot ?? []).map((c) => ({ id: c.id, title: c.title, type: c.type })),
        canceled_labels: canceled.split(",").map((s) => s.trim()).filter(Boolean),
        auto_sync_enabled: connection?.auto_sync_enabled ?? true,
      });
      if (!res.ok) return void setError(res.error);
      setError(null);
      setEditing(false);
      toast.success("Monday.com connection saved");
      router.refresh();
    });
  }

  function sync() {
    startTransition(async () => {
      const res = await syncMondayNow();
      if (!res.ok) return void toast.error(res.error, { duration: 8000 });
      const r = res.data;
      toast.success(`Synced ${r.items_seen} items: ${r.created} new, ${r.updated} updated, ${r.dates_changed} date changes, ${r.flagged_canceled + r.flagged_removed} flagged`);
      router.refresh();
    });
  }

  const columns = schema?.columns ?? connection?.columns_snapshot?.map((c) => ({ ...c, settings_str: null, archived: false })) ?? [];
  const status = !tokenConfigured ? "disconnected" : connection ? (connection.last_error ? "error" : "connected") : "not-set-up";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              Monday.com events
              {status === "connected" ? <Badge variant="success"><CheckCircle2 /> Connected</Badge> : status === "error" ? <Badge variant="destructive"><AlertTriangle /> Error</Badge> : status === "not-set-up" ? <Badge variant="warning">Token set · board not chosen</Badge> : <Badge variant="muted"><Unplug /> Disconnected</Badge>}
            </CardTitle>
            <CardDescription className="mt-1">Read-only import of events from one board. Monday.com stays the source of truth for imported fields; your preparation tasks, notes and social plans stay local.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!tokenConfigured ? (
            <Alert variant="warning">
              <AlertTitle>Not connected</AlertTitle>
              <AlertDescription>
                <p>Add <code>MONDAY_API_TOKEN</code> to the server environment (monday.com → your avatar → Developers → My access tokens), then redeploy. The token never leaves the server.</p>
                <p>Until then you can add events manually from the Events page.</p>
              </AlertDescription>
            </Alert>
          ) : null}

          {connection && !editing ? (
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-xs">Board</dt>
                  <dd className="font-medium">{connection.board_name ?? connection.board_id} <span className="text-muted-foreground font-normal">#{connection.board_id}</span></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Last successful sync</dt>
                  <dd className="font-medium">{connection.last_success_at ? `${formatTimestamp(connection.last_success_at, timezone, { withYear: true })} (${timeAgo(connection.last_success_at)})` : "Never"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground text-xs">Column mapping</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {FIELD_ORDER.filter((k) => connection.column_map[k]).map((k) => {
                      const id = connection.column_map[k]!;
                      const col = connection.columns_snapshot?.find((c) => c.id === id);
                      return (
                        <Badge key={k} variant="secondary">
                          {FIELD_LABELS[k].label}: {id === NAME_COLUMN ? "Item name" : col?.title ?? id}
                        </Badge>
                      );
                    })}
                  </dd>
                </div>
              </dl>
              {connection.last_error ? (
                <Alert variant="destructive">
                  <AlertTitle>Last sync failed</AlertTitle>
                  <AlertDescription>{connection.last_error}</AlertDescription>
                </Alert>
              ) : null}
              {connection.last_result ? (
                <p className="text-muted-foreground text-xs">
                  Last run: {connection.last_result.items_seen} items · {connection.last_result.created} new · {connection.last_result.updated} updated · {connection.last_result.dates_changed} date changes · {connection.last_result.flagged_canceled} canceled · {connection.last_result.flagged_removed} removed · {Math.round(connection.last_result.duration_ms / 100) / 10}s
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={sync} disabled={pending || !tokenConfigured}>
                  {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
                </Button>
                <Button variant="outline" onClick={() => { setEditing(true); test(); inspect(connection.board_id); }} disabled={!tokenConfigured}>
                  Change board or mapping
                </Button>
                <Button variant="ghost" className="text-destructive" disabled={pending} onClick={() => { if (window.confirm("Disconnect this board? Imported events stay in FRADY OS but stop updating.")) startTransition(async () => { const r = await disconnectMonday(); if (!r.ok) toast.error(r.error); else { toast.success("Disconnected"); router.refresh(); } }); }}>
                  <Unplug /> Disconnect
                </Button>
                <label className="ml-auto flex items-center gap-2 text-sm">
                  <Switch checked={connection.auto_sync_enabled} onCheckedChange={(v) => startTransition(async () => { const r = await setMondayAutoSync(v); if (!r.ok) toast.error(r.error); else router.refresh(); })} />
                  Scheduled sync
                </label>
              </div>
              {!cronConfigured || !adminConfigured ? (
                <p className="text-muted-foreground text-xs">
                  Scheduled sync runs from <code>/api/cron/monday-sync</code> (see <code>vercel.json</code>) and needs <code>CRON_SECRET</code> and <code>SUPABASE_SECRET_KEY</code>. {!cronConfigured ? "CRON_SECRET is missing." : ""} {!adminConfigured ? "SUPABASE_SECRET_KEY is missing." : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          {editing && tokenConfigured ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={test} disabled={pending}>
                  {pending && !boards ? <Loader2 className="animate-spin" /> : <Plug />} {me ? "Refresh boards" : "Test connection & load boards"}
                </Button>
                {me ? <span className="text-muted-foreground text-xs">Signed in as {me.name}{me.account ? ` · ${me.account}` : ""}</span> : null}
              </div>
              {boards ? (
                <Field label="Board" hint="Only boards this token can see are listed.">
                  <NativeSelect value={boardId} onChange={(e) => inspect(e.target.value)}>
                    <option value="">Choose a board…</option>
                    {boards.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}{b.workspace?.name ? ` — ${b.workspace.name}` : ""}{typeof b.items_count === "number" ? ` (${b.items_count} items)` : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              {(schema || (connection && columns.length)) && boardId ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Map board columns {schema ? <span className="text-muted-foreground font-normal">· {schema.columns.length} columns found</span> : null}</p>
                    {schema?.url ? <a href={schema.url} target="_blank" rel="noreferrer noopener" className="text-primary inline-flex items-center gap-1 text-xs hover:underline">Open board <ExternalLink className="size-3" /></a> : null}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {FIELD_ORDER.map((key) => {
                      const allowed = FIELD_COLUMN_TYPES[key];
                      const options = columns.filter((c) => !c.archived);
                      const preferred = options.filter((c) => allowed.includes(c.type));
                      const others = options.filter((c) => !allowed.includes(c.type));
                      const disabled = key === "end" && columns.find((c) => c.id === map.start)?.type === "timeline";
                      return (
                        <Field key={key} label={`${FIELD_LABELS[key].label}${key === "start" ? " *" : ""}`} hint={disabled ? "Provided by the Timeline column." : FIELD_LABELS[key].hint}>
                          <NativeSelect value={map[key] ?? ""} disabled={disabled} onChange={(e) => setMap({ ...map, [key]: e.target.value || null })}>
                            <option value="">{key === "name" ? "Item name (default)" : "Not mapped"}</option>
                            {key === "name" ? <option value={NAME_COLUMN}>Item name</option> : null}
                            {preferred.length ? (
                              <optgroup label="Suggested">
                                {preferred.map((c) => (
                                  <option key={c.id} value={c.id}>{c.title} ({c.type})</option>
                                ))}
                              </optgroup>
                            ) : null}
                            {others.length ? (
                              <optgroup label="Other columns">
                                {others.map((c) => (
                                  <option key={c.id} value={c.id}>{c.title} ({c.type})</option>
                                ))}
                              </optgroup>
                            ) : null}
                          </NativeSelect>
                        </Field>
                      );
                    })}
                  </div>
                  <Field label="Status labels that mean canceled" hint="Comma-separated. Matching events are flagged for review, never deleted.">
                    <Input value={canceled} onChange={(e) => setCanceled(e.target.value)} />
                  </Field>
                  <p className="text-muted-foreground text-xs">
                    Program values that match a work area name ({workAreas.map((a) => a.name).join(", ")}) are assigned automatically the first time an event is imported.
                  </p>
                </div>
              ) : null}
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex items-center gap-2">
                <Button onClick={save} disabled={pending || !boardId || !map.start}>
                  {pending ? <Loader2 className="animate-spin" /> : null} Save connection
                </Button>
                {connection ? (
                  <Button variant="ghost" onClick={() => { setEditing(false); setError(null); }}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {error && !editing ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {connection && !editing ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><Zap className="size-4" /> Real-time updates (webhook)</CardTitle>
              <CardDescription className="mt-1">Monday.com can call FRADY OS the moment an item changes. Each call re-runs the same read-only sync, so nothing local is ever touched.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!webhookUrl ? (
              <Alert variant="warning">
                <AlertTitle>Webhook secret not configured</AlertTitle>
                <AlertDescription>Set <code>MONDAY_WEBHOOK_SECRET</code> (any random string, 16+ characters) on the server and redeploy. The URL to paste into Monday appears here afterwards.</AlertDescription>
              </Alert>
            ) : (
              <>
                <Field label="Webhook URL" hint="Paste into Monday's “Send a webhook” recipe (Integrations → Webhooks), or register automatically below.">
                  <div className="flex items-center gap-2">
                    <Input readOnly value={webhookUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                    <Button type="button" variant="outline" size="icon" aria-label="Copy webhook URL" onClick={() => { navigator.clipboard.writeText(webhookUrl).then(() => toast.success("Copied")); }}>
                      <Copy />
                    </Button>
                  </div>
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  {(connection.webhook_ids ?? []).length ? (
                    <>
                      <Badge variant="success"><CheckCircle2 /> {(connection.webhook_ids ?? []).length} webhooks registered</Badge>
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => { const r = await removeMondayWebhooks(); if (!r.ok) toast.error(r.error); else { toast.success(`Removed ${r.data.removed} webhooks`); router.refresh(); } })}>
                        Remove webhooks
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" disabled={pending || !tokenConfigured} onClick={() => startTransition(async () => { const r = await registerMondayWebhooks(); if (!r.ok) toast.error(r.error, { duration: 8000 }); else { toast.success(`Registered ${r.data.created} webhooks on the board`); router.refresh(); } })}>
                      {pending ? <Loader2 className="animate-spin" /> : <Zap />} Register webhooks automatically
                    </Button>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {connection.last_webhook_at ? `Last webhook received ${timeAgo(connection.last_webhook_at)}` : "No webhook received yet"}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">Automatic registration creates recipes for item created, any column changed, name changed, item deleted, archived and restored. The daily scheduled sync stays on as a safety net.</p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {runs.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent sync runs</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <Badge variant={r.status === "success" ? "success" : r.status === "error" ? "destructive" : "muted"}>{r.status}</Badge>
                  <span className="text-muted-foreground text-xs">{r.trigger}</span>
                  <span className="tabular-nums">{formatTimestamp(r.started_at, timezone, { withYear: true })}</span>
                  {r.result ? <span className="text-muted-foreground text-xs">{r.result.items_seen} items · {r.result.created} new · {r.result.updated} updated</span> : null}
                  {r.error ? <span className="text-destructive text-xs">{r.error}</span> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function suggestMapping(schema: MondayBoardSchema): MondayColumnMap {
  const cols = schema.columns.filter((c) => !c.archived);
  const find = (types: string[], words: string[]) =>
    cols.find((c) => types.includes(c.type) && words.some((w) => c.title.toLowerCase().includes(w)))?.id ??
    cols.find((c) => types.includes(c.type))?.id ??
    null;
  const timeline = cols.find((c) => c.type === "timeline");
  const start = timeline?.id ?? find(["date"], ["start", "event", "date"]);
  const end = timeline ? null : cols.filter((c) => c.type === "date" && c.id !== start).find((c) => /end|finish/i.test(c.title))?.id ?? null;
  return {
    name: NAME_COLUMN,
    start,
    end,
    location: find(["location"], ["location", "venue"]) ?? cols.find((c) => c.type === "text" && /location|venue|where/i.test(c.title))?.id ?? null,
    program: cols.find((c) => ["dropdown", "status"].includes(c.type) && /program|area|brand|team|category/i.test(c.title))?.id ?? null,
    owner: find(["people", "person"], ["owner", "lead", "assigned"]),
    status: cols.find((c) => c.type === "status" && /status/i.test(c.title))?.id ?? cols.find((c) => c.type === "status")?.id ?? null,
    website: find(["link"], ["site", "web", "regist", "url", "link"]),
    notes: find(["long_text"], ["note", "detail", "description"]),
  };
}
