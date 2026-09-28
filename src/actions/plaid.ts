"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { siteOrigin } from "@/lib/monday/webhook";
import { createLinkToken, diagnosePlaidKeys, exchangePublicToken, getInstitutionName, isPlaidConfigured, plaidEnv, plaidProducts, plaidRedirectUri, removeItem, PlaidError, type PlaidEnv, type PlaidKeyDiagnosis } from "@/lib/plaid/client";
import { decryptToken, encryptToken, keySource } from "@/lib/plaid/crypto";
import { runPlaidSync, syncItems } from "@/lib/plaid/sync";
import { describePlaidError } from "@/lib/plaid/mapping";
import type { PlaidItem, PlaidSyncResult } from "@/lib/finance/types";

function revalidate() {
  revalidatePath("/", "layout");
}

function ready(): string | null {
  if (!isPlaidConfigured()) return "Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET (your CLIENT_ID / SECRET_Plaid values) to the server environment and redeploy.";
  if (!isAdminConfigured()) return "SUPABASE_SECRET_KEY is required so access tokens can be stored server-side.";
  if (keySource() === "none") return "Set PLAID_TOKEN_ENCRYPTION_KEY (or CRON_SECRET) so access tokens can be encrypted.";
  return null;
}

async function ownedItem(userId: string, itemId: string): Promise<PlaidItem | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("plaid_items").select("*").eq("item_id", itemId).eq("user_id", userId).maybeSingle();
  return (data as PlaidItem | null) ?? null;
}

async function accessTokenFor(itemId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("plaid_item_secrets").select("access_token_enc").eq("item_id", itemId).maybeSingle();
  return data?.access_token_enc ? decryptToken(data.access_token_enc as string) : null;
}

/** Link token for a new connection, or for update mode when `itemId` is given (re-authentication). */
export async function createPlaidLinkToken(input: { itemId?: string | null } = {}): Promise<ActionResult<{ linkToken: string; expiration: string; env: PlaidEnv; redirectUri: string | null; products: string[] }>> {
  try {
    const ws = await requireWorkspace();
    const notReady = ready();
    if (notReady) return fail(notReady);
    let accessToken: string | null = null;
    if (input.itemId) {
      const item = await ownedItem(ws.userId, input.itemId);
      if (!item) return fail("Connection not found");
      accessToken = await accessTokenFor(item.item_id);
      if (!accessToken) return fail("No stored token for this connection. Remove it and connect again.");
    }
    const origin = await siteOrigin();
    const redirectUri = plaidRedirectUri();
    const res = await createLinkToken({ userId: ws.userId, webhook: `${origin}/api/webhooks/plaid`, redirectUri, accessToken });
    return ok({ linkToken: res.link_token, expiration: res.expiration, env: plaidEnv(), redirectUri, products: plaidProducts() });
  } catch (e) {
    return fail(e instanceof PlaidError ? describePlaidError(e.code, e.message) : errorMessage(e));
  }
}

const completeSchema = z.object({
  publicToken: z.string().min(10).max(500),
  institution: z.object({ id: z.string().max(100).nullable().optional(), name: z.string().max(200).nullable().optional() }).nullable().optional(),
});

/** Exchanges the public token from Link, stores the encrypted access token and runs the first sync. */
export async function completePlaidLink(input: unknown): Promise<ActionResult<{ itemId: string; institution: string | null; result: PlaidSyncResult | null; warning: string | null }>> {
  try {
    const ws = await requireWorkspace();
    const notReady = ready();
    if (notReady) return fail(notReady);
    const parsed = completeSchema.safeParse(input);
    if (!parsed.success) return fail("Invalid Link response");
    const { publicToken, institution } = parsed.data;
    const admin = createAdminClient();
    const ex = await exchangePublicToken(publicToken);
    const institutionName = institution?.name ?? (institution?.id ? await getInstitutionName(institution.id) : null);
    const { error: itemErr } = await admin
      .from("plaid_items")
      .upsert({ user_id: ws.userId, item_id: ex.item_id, institution_id: institution?.id ?? null, institution_name: institutionName, environment: plaidEnv(), status: "active", error_code: null, error_message: null, products: plaidProducts() }, { onConflict: "item_id" });
    if (itemErr) return fail(itemErr.message);
    const { error: secErr } = await admin.from("plaid_item_secrets").upsert({ item_id: ex.item_id, user_id: ws.userId, access_token_enc: encryptToken(ex.access_token) }, { onConflict: "item_id" });
    if (secErr) return fail(secErr.message);
    const item = await ownedItem(ws.userId, ex.item_id);
    let result: PlaidSyncResult | null = null;
    let warning: string | null = null;
    if (item) {
      try {
        result = await runPlaidSync(admin, item, { trigger: "link", realtime: true });
      } catch (e) {
        warning = e instanceof PlaidError ? describePlaidError(e.code, e.message) : errorMessage(e);
      }
    }
    revalidate();
    return ok({ itemId: ex.item_id, institution: institutionName, result, warning });
  } catch (e) {
    return fail(e instanceof PlaidError ? describePlaidError(e.code, e.message) : errorMessage(e));
  }
}

/** After update-mode Link succeeds: clear the error state and sync again. */
export async function completePlaidReconnect(itemId: string): Promise<ActionResult<{ result: PlaidSyncResult | null; warning: string | null }>> {
  try {
    const ws = await requireWorkspace();
    const item = await ownedItem(ws.userId, itemId);
    if (!item) return fail("Connection not found");
    const admin = createAdminClient();
    await admin.from("plaid_items").update({ status: "active", error_code: null, error_message: null }).eq("item_id", itemId);
    let result: PlaidSyncResult | null = null;
    let warning: string | null = null;
    try {
      result = await runPlaidSync(admin, { ...item, status: "active" }, { trigger: "link", realtime: true });
    } catch (e) {
      warning = e instanceof PlaidError ? describePlaidError(e.code, e.message) : errorMessage(e);
    }
    revalidate();
    return ok({ result, warning });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Real-time balance refresh (+ transactions) for one connection or all of them. */
export async function syncPlaidNow(itemId?: string | null): Promise<ActionResult<{ synced: number; failed: { institution: string | null; error: string }[]; results: PlaidSyncResult[] }>> {
  try {
    const ws = await requireWorkspace();
    const notReady = ready();
    if (notReady) return fail(notReady);
    const admin = createAdminClient();
    let q = admin.from("plaid_items").select("*").eq("user_id", ws.userId).neq("status", "disconnected");
    if (itemId) q = q.eq("item_id", itemId);
    const { data, error } = await q;
    if (error) return fail(error.message);
    const items = (data ?? []) as PlaidItem[];
    if (!items.length) return fail("No bank connections yet");
    const out = await syncItems(admin, items, { trigger: "manual", realtime: true });
    revalidate();
    return ok({
      synced: out.filter((o) => o.ok).length,
      failed: out.filter((o) => !o.ok).map((o) => ({ institution: o.item.institution_name, error: o.error ?? "failed" })),
      results: out.filter((o) => o.ok).map((o) => o.result!),
    });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/**
 * Removes the connection at Plaid and forgets the token. Linked accounts either stay as manual
 * accounts (history preserved) or are deleted together with their transactions.
 */
export async function disconnectPlaidItem(itemId: string, opts: { deleteAccounts?: boolean } = {}): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const item = await ownedItem(ws.userId, itemId);
    if (!item) return fail("Connection not found");
    const admin = createAdminClient();
    const token = await accessTokenFor(itemId).catch(() => null);
    if (token) {
      try {
        await removeItem(token);
      } catch (e) {
        if (!(e instanceof PlaidError && (e.code === "ITEM_NOT_FOUND" || e.code === "INVALID_ACCESS_TOKEN"))) console.warn("plaid item/remove failed", e instanceof Error ? e.message : e);
      }
    }
    const supabase = await createClient();
    if (opts.deleteAccounts) {
      const { error } = await supabase.from("financial_accounts").delete().eq("user_id", ws.userId).eq("plaid_item_id", itemId);
      if (error) return fail(error.message);
    } else {
      const { error } = await supabase.from("financial_accounts").update({ external_provider: null, external_account_id: null, plaid_item_id: null, sync_error: null, available_balance: null }).eq("user_id", ws.userId).eq("plaid_item_id", itemId);
      if (error) return fail(error.message);
    }
    const { error } = await admin.from("plaid_items").delete().eq("item_id", itemId).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidate();
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Tests the server's Plaid keys against both environments without exposing them. */
export async function testPlaidKeys(): Promise<ActionResult<PlaidKeyDiagnosis>> {
  try {
    await requireWorkspace();
    return ok(await diagnosePlaidKeys());
  } catch (e) {
    return fail(errorMessage(e));
  }
}
