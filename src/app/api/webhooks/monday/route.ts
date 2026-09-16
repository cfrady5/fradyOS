import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isMondayConfigured } from "@/lib/monday/client";
import { runMondaySync } from "@/lib/monday/sync";
import { isMondayWebhookConfigured, timingSafeEqual } from "@/lib/monday/webhook";
import type { MondayConnection } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Shape of Monday's webhook body: a one-time challenge, or an event envelope. */
const payloadSchema = z.object({
  challenge: z.string().max(500).optional(),
  event: z
    .object({
      type: z.string().max(100).optional(),
      boardId: z.union([z.number(), z.string()]).optional(),
      pulseId: z.union([z.number(), z.string()]).optional(),
    })
    .passthrough()
    .optional(),
});

// Events arriving within this window after a sync started are coalesced into one follow-up sync.
const COALESCE_MS = 15_000;

/**
 * Monday.com → FRADY OS. Read-only: every accepted event simply re-runs the board sync,
 * so dedupe, cancel/removed flags and "never touch local work" all behave exactly like "Sync now".
 */
export async function POST(request: NextRequest) {
  const secret = process.env.MONDAY_WEBHOOK_SECRET?.trim() ?? "";
  if (!isMondayWebhookConfigured()) return NextResponse.json({ error: "MONDAY_WEBHOOK_SECRET is not configured (16+ characters)" }, { status: 500 });
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!timingSafeEqual(token, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Unexpected payload" }, { status: 400 });

  // Monday verifies the URL by sending { challenge } and expecting it echoed back.
  if (parsed.data.challenge) return NextResponse.json({ challenge: parsed.data.challenge });

  const boardId = parsed.data.event?.boardId != null ? String(parsed.data.event.boardId) : null;
  if (!boardId) return NextResponse.json({ ignored: true, reason: "no boardId in event" });
  if (!isMondayConfigured() || !isAdminConfigured()) return NextResponse.json({ ignored: true, reason: "MONDAY_API_TOKEN or SUPABASE_SECRET_KEY not configured" });

  const admin = createAdminClient();
  const { data, error } = await admin.from("monday_connections").select("*").eq("board_id", boardId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const connections = (data ?? []) as MondayConnection[];
  if (!connections.length) return NextResponse.json({ ignored: true, reason: "board not connected" });

  const receivedAt = Date.now();
  const receivedIso = new Date(receivedAt).toISOString();
  await admin.from("monday_connections").update({ last_webhook_at: receivedIso }).in("id", connections.map((c) => c.id));

  // Respond immediately; sync after the response so Monday never times out or retries.
  after(async () => {
    for (const conn of connections) {
      const last = conn.last_sync_started_at ? new Date(conn.last_sync_started_at).getTime() : 0;
      const wait = Math.max(0, COALESCE_MS - (receivedAt - last));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      // If another sync started after this event arrived, it already covers this change.
      const { data: fresh } = await admin.from("monday_connections").select("last_sync_started_at").eq("id", conn.id).maybeSingle();
      const freshLast = fresh?.last_sync_started_at ? new Date(fresh.last_sync_started_at as string).getTime() : 0;
      if (freshLast > receivedAt) continue;
      try {
        await runMondaySync(admin, conn.user_id, conn, "webhook");
      } catch (e) {
        console.error("monday webhook sync failed", e instanceof Error ? e.message : e);
      }
    }
  });

  return NextResponse.json({ accepted: true, event: parsed.data.event?.type ?? null, board: boardId });
}

export async function GET() {
  // Monday only POSTs; a GET is someone poking the URL.
  return NextResponse.json({ ok: true, expects: "POST from monday.com" });
}
