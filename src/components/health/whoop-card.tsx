"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Link2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/app/items";
import { disconnectWhoop, syncWhoopNow } from "@/actions/intel";
import type { WhoopStatus } from "@/lib/data/intel";
import { formatTimestamp } from "@/lib/dates";

/** Connect, sync or disconnect the WHOOP developer API. Tokens never reach the browser. */
export function WhoopCard({ status, configured }: { status: WhoopStatus; configured: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const flash = params.get("whoop");
  React.useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => {
      if (flash === "connected") toast.success("WHOOP connected. Backfilling the last 180 days in the background.");
      else if (flash === "unconfigured") toast.error("WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are not set on the server.");
      else if (flash === "state_mismatch") toast.error("The sign-in did not complete. Try connecting again.");
      else if (flash === "error") toast.error(`WHOOP connection failed: ${params.get("message") ?? "unknown error"}`);
      router.replace("/health/data");
    }, 0);
    return () => window.clearTimeout(id);
  }, [flash, params, router]);

  function sync() {
    startTransition(async () => {
      const res = await syncWhoopNow();
      if (res.ok) {
        toast.success(`Synced ${res.data.cycles} cycles, ${res.data.sleeps} sleeps, ${res.data.workouts} workouts.`);
        router.refresh();
      } else toast.error(res.error);
    });
  }
  function disconnect() {
    if (!window.confirm("Disconnect WHOOP? Stored API records stay; nothing new will arrive until you reconnect.")) return;
    startTransition(async () => {
      const res = await disconnectWhoop();
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  return (
    <section aria-labelledby="whoop-api">
      <SectionHeader title={<span id="whoop-api">WHOOP API</span>} hint={status.connected ? status.status ?? undefined : configured ? "Not connected" : "Server keys not set"} />
      <div className="border-line-1 mt-3 flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between">
        <div className="text-sm">
          {status.connected ? (
            <>
              <p className="text-text-1">Connected{status.backfillDone ? "" : " (backfill in progress)"}.</p>
              <p className="text-text-3 text-meta nums mt-1">
                Last sync {status.lastSyncedAt ? formatTimestamp(status.lastSyncedAt) : "never"}
                {status.lastWebhookAt ? ` · last webhook ${formatTimestamp(status.lastWebhookAt)}` : ""}
              </p>
              {status.error ? <p className="text-danger mt-1 text-sm">{status.error}</p> : null}
            </>
          ) : (
            <>
              <p className="text-text-1">Pull cycles, recovery, sleep and workouts straight from WHOOP, with webhooks for same-day updates.</p>
              <p className="text-text-3 text-meta mt-1">{configured ? "You will be sent to WHOOP to approve read-only access." : "Set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET on the server first (see docs/HEALTH_INTELLIGENCE.md)."}</p>
            </>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {status.connected ? (
            <>
              <Button size="sm" variant="outline" onClick={sync} disabled={pending}><RefreshCw className={pending ? "animate-spin" : undefined} /> Sync now</Button>
              <Button size="sm" variant="ghost" onClick={disconnect} disabled={pending}><Unplug /> Disconnect</Button>
            </>
          ) : (
            <Button size="sm" asChild={configured} disabled={!configured}>
              {configured ? <a href="/api/whoop/connect"><Link2 /> Connect WHOOP</a> : <span><Link2 /> Connect WHOOP</span>}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
