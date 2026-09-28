import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isPlaidConfigured, PlaidError } from "@/lib/plaid/client";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook";
import { recordItemError, runPlaidSync } from "@/lib/plaid/sync";
import type { PlaidItem } from "@/lib/finance/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const payloadSchema = z
  .object({
    webhook_type: z.string().max(60),
    webhook_code: z.string().max(60),
    item_id: z.string().max(200).optional(),
    error: z.object({ error_code: z.string().max(100).nullable().optional(), error_message: z.string().max(1000).nullable().optional() }).nullable().optional(),
    consent_expiration_time: z.string().max(60).nullable().optional(),
    environment: z.string().max(20).optional(),
  })
  .passthrough();

/**
 * Plaid → FRADY OS. Every request is verified against Plaid's signing key before the body is parsed.
 * Transaction updates re-run the Item sync; Item lifecycle events update the connection status.
 */
export async function POST(request: NextRequest) {
  if (!isPlaidConfigured() || !isAdminConfigured()) return NextResponse.json({ ignored: true, reason: "Plaid or SUPABASE_SECRET_KEY not configured" });
  const raw = await request.text();
  const verified = await verifyPlaidWebhook(raw, request.headers.get("plaid-verification"));
  if (!verified.ok) return NextResponse.json({ error: verified.reason }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Unexpected payload" }, { status: 400 });
  const evt = parsed.data;
  if (!evt.item_id) return NextResponse.json({ ignored: true, reason: "no item_id" });

  const admin = createAdminClient();
  const { data } = await admin.from("plaid_items").select("*").eq("item_id", evt.item_id).maybeSingle();
  const item = data as PlaidItem | null;
  if (!item) return NextResponse.json({ ignored: true, reason: "unknown item" });
  await admin.from("plaid_items").update({ last_webhook_at: new Date().toISOString() }).eq("item_id", item.item_id);

  const type = evt.webhook_type;
  const code = evt.webhook_code;
  after(async () => {
    try {
      if (type === "TRANSACTIONS" || (type === "LIABILITIES" && code === "DEFAULT_UPDATE") || (type === "ITEM" && (code === "LOGIN_REPAIRED" || code === "NEW_ACCOUNTS_AVAILABLE"))) {
        if (type === "ITEM") await admin.from("plaid_items").update({ status: "active", error_code: null, error_message: null }).eq("item_id", item.item_id);
        await runPlaidSync(admin, { ...item, status: "active" }, { trigger: "webhook", realtime: false });
      } else if (type === "ITEM" && code === "ERROR") {
        await recordItemError(admin, item, new PlaidError(evt.error?.error_message ?? "Item error", { code: evt.error?.error_code ?? "ITEM_ERROR" }));
      } else if (type === "ITEM" && (code === "PENDING_EXPIRATION" || code === "PENDING_DISCONNECT")) {
        await admin.from("plaid_items").update({ status: "reauth_required", error_code: code, error_message: code === "PENDING_EXPIRATION" ? "Bank consent is expiring soon; reconnect to keep syncing." : "The bank is about to disconnect; reconnect to keep syncing.", consent_expires_at: evt.consent_expiration_time ?? item.consent_expires_at }).eq("item_id", item.item_id);
      } else if (type === "ITEM" && code === "USER_PERMISSION_REVOKED") {
        await admin.from("plaid_items").update({ status: "error", error_code: code, error_message: "Access was revoked at the bank. Reconnect to resume." }).eq("item_id", item.item_id);
      }
    } catch (e) {
      console.error("plaid webhook handling failed", e instanceof Error ? e.message : e);
    }
  });
  return NextResponse.json({ received: true, type, code });
}
