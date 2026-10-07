"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Landmark, Loader2, Plug, RefreshCw, Unplug, AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { completePlaidLink, completePlaidReconnect, createPlaidLinkToken, disconnectPlaidItem, syncPlaidNow, testPlaidKeys } from "@/actions/plaid";
import type { PlaidKeyDiagnosis } from "@/lib/plaid/client";
import type { PlaidItem, PlaidSyncRun } from "@/lib/finance/types";
import { formatTimestamp, timeAgo } from "@/lib/dates";
import { useWorkspace } from "@/components/app/workspace-provider";

type LinkHandler = { open: () => void; exit: (opts?: { force?: boolean }) => void; destroy: () => void };
type LinkConfig = {
  token: string;
  receivedRedirectUri?: string;
  onSuccess: (publicToken: string, metadata: { institution?: { institution_id: string; name: string } | null }) => void;
  onExit?: (err: { error_code?: string | null; display_message?: string | null } | null) => void;
};
declare global {
  interface Window {
    Plaid?: { create: (cfg: LinkConfig) => LinkHandler };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadPlaidLink(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Plaid) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error("Could not load Plaid Link. Check your network or ad blocker."));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

const STORAGE_KEY = "fradyos.plaid.link";

export type PlaidStatus = { configured: boolean; env: "sandbox" | "production"; keySource: "env" | "derived" | "none"; products: string[] };

export function PlaidConnections({ status, items, runs, accountCounts }: { status: PlaidStatus; items: PlaidItem[]; runs: PlaidSyncRun[]; accountCounts: Record<string, number> }) {
  const router = useRouter();
  const search = useSearchParams();
  const { timezone } = useWorkspace();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [diagnosis, setDiagnosis] = React.useState<PlaidKeyDiagnosis | null>(null);
  const [pending, startTransition] = React.useTransition();

  function testKeys() {
    setBusy("test");
    startTransition(async () => {
      const res = await testPlaidKeys();
      setBusy(null);
      if (!res.ok) return void setError(res.error);
      setDiagnosis(res.data);
    });
  }

  const launch = React.useCallback(
    async (token: string, itemId: string | null, receivedRedirectUri?: string) => {
      try {
        await loadPlaidLink();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load Plaid Link");
        setBusy(null);
        return;
      }
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, itemId }));
      } catch {
        /* private mode */
      }
      const handler = window.Plaid!.create({
        token,
        receivedRedirectUri,
        onSuccess: (publicToken, metadata) => {
          try {
            sessionStorage.removeItem(STORAGE_KEY);
          } catch {
            /* ignore */
          }
          setBusy(itemId ? `reauth:${itemId}` : "finishing");
          startTransition(async () => {
            const res = itemId ? await completePlaidReconnect(itemId) : await completePlaidLink({ publicToken, institution: metadata.institution ? { id: metadata.institution.institution_id, name: metadata.institution.name } : null });
            if (!res.ok) setError(res.error);
            else {
              const r = res.data.result;
              toast.success(itemId ? "Bank reconnected" : `Connected${"institution" in res.data && res.data.institution ? ` ${res.data.institution}` : ""}${r ? ` · ${r.accounts_seen} account${r.accounts_seen === 1 ? "" : "s"}` : ""}`);
              if (res.data.warning) toast.warning(res.data.warning);
              setError(null);
            }
            setBusy(null);
            router.refresh();
          });
        },
        onExit: (err) => {
          try {
            sessionStorage.removeItem(STORAGE_KEY);
          } catch {
            /* ignore */
          }
          if (err?.display_message || err?.error_code) setError(err.display_message ?? err.error_code ?? "Link closed with an error");
          setBusy(null);
        },
      });
      handler.open();
    },
    [router],
  );

  // OAuth banks bounce back here with ?oauth_state_id=…; resume Link with the token saved before the redirect.
  const oauthState = search.get("oauth_state_id");
  React.useEffect(() => {
    if (!oauthState) return;
    let saved: { token?: string; itemId?: string | null } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
    } catch {
      saved = null;
    }
    if (!saved?.token) return;
    const { token, itemId } = saved;
    const t = setTimeout(() => void launch(token, itemId ?? null, window.location.href), 0);
    return () => clearTimeout(t);
  }, [oauthState, launch]);

  function connect(itemId: string | null = null) {
    setError(null);
    setBusy(itemId ? `reauth:${itemId}` : "connect");
    startTransition(async () => {
      const res = await createPlaidLinkToken({ itemId });
      if (!res.ok) {
        setError(res.error);
        setBusy(null);
        return;
      }
      await launch(res.data.linkToken, itemId);
    });
  }

  function sync(itemId: string | null = null) {
    setError(null);
    setBusy(itemId ? `sync:${itemId}` : "sync");
    startTransition(async () => {
      const res = await syncPlaidNow(itemId);
      setBusy(null);
      if (!res.ok) return void setError(res.error);
      const added = res.data.results.reduce((s, r) => s + r.transactions_added + r.transactions_modified, 0);
      toast.success(`Synced ${res.data.synced} connection${res.data.synced === 1 ? "" : "s"}${added ? ` · ${added} transaction${added === 1 ? "" : "s"}` : ""}`);
      for (const f of res.data.failed) toast.error(`${f.institution ?? "Bank"}: ${f.error}`);
      router.refresh();
    });
  }

  function remove(item: PlaidItem) {
    if (!confirm(`Remove ${item.institution_name ?? "this bank"}? Its accounts stay as manual entries with their history; delete them individually if you want them gone.`)) return;
    setBusy(`remove:${item.item_id}`);
    startTransition(async () => {
      const res = await disconnectPlaidItem(item.item_id);
      setBusy(null);
      if (!res.ok) return void setError(res.error);
      toast.success("Bank removed");
      router.refresh();
    });
  }

  const anyBusy = pending || busy !== null;

  return (
    <Card>
      <CardHeader className="flex-wrap items-center">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Landmark className="size-4" /> Bank connections
            <Badge variant={status.env === "production" ? "success" : "warning"}>{status.env === "production" ? "Live banks" : "Sandbox"}</Badge>
          </CardTitle>
          <CardDescription className="mt-1">Balances, APRs, minimums and transactions sync through Plaid. Your bank login never touches FRADY OS: Plaid holds it and hands the app an encrypted token.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {items.length ? (
            <Button variant="outline" size="sm" onClick={() => sync()} disabled={anyBusy}>
              {busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync all
            </Button>
          ) : null}
          <Button size="sm" onClick={() => connect()} disabled={anyBusy || !status.configured}>
            {busy === "connect" || busy === "finishing" ? <Loader2 className="animate-spin" /> : <Plug />} Connect a bank
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!status.configured ? (
          <Alert variant="warning">
            <AlertTitle>Plaid keys are not on the server yet</AlertTitle>
            <AlertDescription>
              <p>
                Add <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code> (the app also accepts <code>CLIENT_ID</code> / <code>SECRET_Plaid</code>) in Vercel → Settings → Environment Variables, then redeploy.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}
        {status.configured && status.keySource === "derived" ? (
          <p className="text-text-2 flex items-start gap-1.5 text-xs">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" /> Tokens are encrypted with a key derived from CRON_SECRET. For a dedicated key set <code>PLAID_TOKEN_ENCRYPTION_KEY</code> (64 hex characters) before connecting banks; changing keys later means reconnecting.
          </p>
        ) : null}
        {status.configured && status.env === "sandbox" ? <p className="text-text-2 text-xs">Sandbox mode: choose any bank in Link and sign in with <code>user_good</code> / <code>pass_good</code>. Switch <code>PLAID_ENV</code> to <code>production</code> with a production secret for real accounts.</p> : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col gap-2">
              <span>{error}</span>
              {status.configured ? (
                <span>
                  <Button type="button" size="sm" variant="outline" onClick={testKeys} disabled={anyBusy}>
                    {busy === "test" ? <Loader2 className="animate-spin" /> : <KeyRound />} Test the Plaid keys
                  </Button>
                </span>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {diagnosis ? (
          <Alert variant={diagnosis.verdict.startsWith("Keys work") ? "default" : "warning"}>
            <AlertTitle>Key check</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>{diagnosis.verdict}</span>
              <span className="text-text-2 text-xs">
                client id from {diagnosis.clientId.source ?? "—"} ({diagnosis.clientId.length} chars) · secret from {diagnosis.secret.source ?? "—"} ({diagnosis.secret.length} chars) · PLAID_ENV {diagnosis.envSetting ?? "not set → sandbox"} · sandbox: {diagnosis.sandbox} · production: {diagnosis.production}
              </span>
            </AlertDescription>
          </Alert>
        ) : null}
        {items.length ? (
          <ul className="divide-line-1 divide-y">
            {items.map((it) => {
              const problem = it.status === "reauth_required" || it.status === "error";
              return (
                <li key={it.item_id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{it.institution_name ?? "Bank"}</span>
                      {it.status === "active" ? (
                        <Badge variant="success">
                          <CheckCircle2 /> Live
                        </Badge>
                      ) : it.status === "reauth_required" ? (
                        <Badge variant="warning">
                          <AlertTriangle /> Reconnect needed
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <AlertTriangle /> Error
                        </Badge>
                      )}
                      <span className="text-text-2 text-xs">{accountCounts[it.item_id] ?? 0} account{(accountCounts[it.item_id] ?? 0) === 1 ? "" : "s"}</span>
                    </div>
                    <div className="text-text-2 mt-0.5 text-xs">
                      {it.last_synced_at ? `Synced ${timeAgo(it.last_synced_at)}` : "Not synced yet"}
                      {it.last_webhook_at ? ` · bank update ${timeAgo(it.last_webhook_at)}` : ""}
                      {it.products?.length ? ` · ${it.products.join(", ")}` : ""}
                    </div>
                    {problem && it.error_message ? <div className="text-danger mt-0.5 text-xs">{it.error_message}</div> : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {problem ? (
                      <Button size="sm" onClick={() => connect(it.item_id)} disabled={anyBusy}>
                        {busy === `reauth:${it.item_id}` ? <Loader2 className="animate-spin" /> : <Plug />} Reconnect
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => sync(it.item_id)} disabled={anyBusy} aria-label={`Sync ${it.institution_name ?? "bank"}`}>
                      {busy === `sync:${it.item_id}` ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(it)} disabled={anyBusy} aria-label={`Remove ${it.institution_name ?? "bank"}`}>
                      {busy === `remove:${it.item_id}` ? <Loader2 className="animate-spin" /> : <Unplug />}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : status.configured ? (
          <p className="text-text-2 text-sm">No banks connected. Connect one and its accounts appear below with live balances; the projection uses them immediately.</p>
        ) : null}
        {runs.length ? (
          <details className="text-xs">
            <summary className="text-text-2 cursor-pointer">Recent syncs</summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <Badge variant={r.status === "success" ? "success" : r.status === "error" ? "destructive" : "muted"}>{r.status}</Badge>
                  <span className="text-text-2">{r.trigger}</span>
                  <span className="nums">{formatTimestamp(r.started_at, timezone)}</span>
                  {r.result ? <span className="text-text-2">{r.result.accounts_seen} accounts · {r.result.transactions_added + r.result.transactions_modified} transactions{r.result.realtime ? " · real-time balances" : ""}</span> : null}
                  {r.error ? <span className="text-danger">{r.error}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
