import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { whoopConfig } from "@/lib/whoop/client";
import { verifyWhoopSignature, WEBHOOK_TYPES } from "@/lib/whoop/webhook";
import { applyWebhook, type WhoopConnection } from "@/lib/whoop/sync";
import { todayIn } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ user_id: z.union([z.number(), z.string()]), id: z.union([z.number(), z.string()]), type: z.enum(WEBHOOK_TYPES), trace_id: z.string().max(200).optional() });

/**
 * WHOOP → FRADY OS. The signature is checked before the body is parsed; each delivery id is recorded
 * so a redelivery is a no-op; the one record named is re-fetched in the background.
 */
export async function POST(request: NextRequest) {
  const cfg = whoopConfig();
  if (!cfg || !isAdminConfigured()) return NextResponse.json({ ignored: true, reason: "WHOOP or SUPABASE_SECRET_KEY not configured" });
  const raw = await request.text();
  const verified = verifyWhoopSignature(raw, request.headers.get("x-whoop-signature"), request.headers.get("x-whoop-signature-timestamp"), cfg.clientSecret);
  if (!verified.ok) return NextResponse.json({ error: verified.reason }, { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Unexpected payload" }, { status: 400 });
  const evt = parsed.data;
  const admin = createAdminClient();
  const deliveryId = evt.trace_id ?? `${evt.type}:${evt.id}:${request.headers.get("x-whoop-signature-timestamp")}`;
  const { data: conn } = await admin.from("whoop_connections").select("*").eq("whoop_user_id", String(evt.user_id)).maybeSingle();
  if (!conn) return NextResponse.json({ ignored: true, reason: "unknown user" });
  const { error: dupError } = await admin.from("whoop_webhook_events").insert({ id: deliveryId, user_id: (conn as WhoopConnection).user_id, type: evt.type });
  if (dupError) return NextResponse.json({ ignored: true, reason: "duplicate delivery" });
  const { data: profile } = await admin.from("profiles").select("timezone").eq("id", (conn as WhoopConnection).user_id).maybeSingle();
  const timezone = (profile as { timezone?: string } | null)?.timezone || "America/Indiana/Indianapolis";
  after(async () => {
    await applyWebhook(admin, conn as WhoopConnection, evt, { timezone, today: todayIn(timezone) }).catch(() => undefined);
  });
  return NextResponse.json({ accepted: true });
}
