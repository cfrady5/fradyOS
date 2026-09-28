import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccounts, getBalances, getItem, getLiabilities, PlaidError, REAUTH_CODES, syncTransactionsPage, type PlaidAccount, type PlaidLiabilities, type PlaidTransaction } from "./client";
import { decryptToken } from "./crypto";
import { displayName, isPlaidLiability, mapAccountType, mapBalance, mapTransaction, matchBudgetCategory } from "./mapping";
import type { FinancialAccount, PlaidItem, PlaidSyncResult } from "@/lib/finance/types";
import { DEFAULT_TIMEZONE, todayIn } from "@/lib/dates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;
export type PlaidTrigger = "link" | "manual" | "scheduled" | "webhook";

export interface SyncOptions {
  trigger: PlaidTrigger;
  /** Use /accounts/balance/get (billed, real-time) instead of the cached balances from /accounts/get. */
  realtime?: boolean;
  /** Pull transactions via /transactions/sync (default true when the Item has the product). */
  transactions?: boolean;
}

function liabilityFor(liabs: PlaidLiabilities | null, accountId: string): { rate: number | null; minimum: number | null; original: number | null } {
  if (!liabs) return { rate: null, minimum: null, original: null };
  const c = liabs.credit?.find((x) => x.account_id === accountId);
  if (c) {
    const apr = c.aprs?.find((a) => a.apr_type === "purchase_apr") ?? c.aprs?.[0];
    return { rate: apr?.apr_percentage ?? null, minimum: c.minimum_payment_amount ?? null, original: null };
  }
  const s = liabs.student?.find((x) => x.account_id === accountId);
  if (s) return { rate: s.interest_rate_percentage ?? null, minimum: s.minimum_payment_amount ?? null, original: s.origination_principal_amount ?? null };
  const m = liabs.mortgage?.find((x) => x.account_id === accountId);
  if (m) return { rate: m.interest_rate?.percentage ?? null, minimum: m.next_monthly_payment ?? null, original: m.origination_principal_amount ?? null };
  return { rate: null, minimum: null, original: null };
}

async function markItem(supabase: Client, item: PlaidItem, patch: Record<string, unknown>) {
  await supabase.from("plaid_items").update(patch).eq("item_id", item.item_id);
}

/** Classifies a Plaid failure onto the Item and returns a readable message. */
export async function recordItemError(supabase: Client, item: PlaidItem, e: unknown): Promise<string> {
  if (e instanceof PlaidError) {
    const reauth = REAUTH_CODES.has(e.code);
    await markItem(supabase, item, { status: reauth ? "reauth_required" : "error", error_code: e.code, error_message: e.message });
    return `${e.code}: ${e.message}`;
  }
  const msg = e instanceof Error ? e.message : "Sync failed";
  await markItem(supabase, item, { status: "error", error_code: null, error_message: msg });
  return msg;
}

/**
 * Pulls accounts (+ liabilities, + transactions) for one Plaid Item into the user's finance tables.
 * Plaid is the source of truth for balance, mask, official name, APR and minimum payment; everything
 * the user sets by hand (name, contribution, include-in-net-worth, notes, actual payment) is kept.
 */
export async function runPlaidSync(supabase: Client, item: PlaidItem, opts: SyncOptions): Promise<PlaidSyncResult> {
  const userId = item.user_id;
  const { data: run } = await supabase.from("plaid_sync_runs").insert({ user_id: userId, item_id: item.item_id, trigger: opts.trigger, status: "running" }).select("id").single();
  const runId = run?.id as string | undefined;
  const result: PlaidSyncResult = { accounts_seen: 0, accounts_created: 0, accounts_updated: 0, transactions_added: 0, transactions_modified: 0, transactions_removed: 0, liabilities: false, realtime: Boolean(opts.realtime), warnings: [] };
  const finish = async (status: "success" | "error", error?: string) => {
    if (runId) await supabase.from("plaid_sync_runs").update({ status, finished_at: new Date().toISOString(), result, error: error ?? null }).eq("id", runId);
  };

  try {
    const { data: secret } = await supabase.from("plaid_item_secrets").select("access_token_enc").eq("item_id", item.item_id).maybeSingle();
    if (!secret?.access_token_enc) throw new Error("No stored access token for this connection. Reconnect the bank.");
    const token = decryptToken(secret.access_token_enc as string);
    const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
    const today = todayIn((profile?.timezone as string) || DEFAULT_TIMEZONE);
    const now = new Date().toISOString();

    let accounts: PlaidAccount[];
    let products = item.products ?? [];
    try {
      const res = opts.realtime ? await getBalances(token) : await getAccounts(token);
      accounts = res.accounts;
      if (res.item?.products?.length) products = res.item.products;
    } catch (e) {
      if (e instanceof PlaidError && e.code === "PRODUCT_NOT_READY") {
        result.warnings.push("Plaid is still preparing this connection; balances will arrive shortly.");
        accounts = (await getAccounts(token)).accounts;
      } else throw e;
    }
    if (!products.length || (!products.includes("transactions") && !products.includes("liabilities"))) {
      try {
        const info = await getItem(token);
        products = info.item.products ?? info.item.billed_products ?? products;
        if (info.item.consent_expiration_time) await markItem(supabase, item, { consent_expires_at: info.item.consent_expiration_time });
      } catch {
        /* optional */
      }
    }

    let liabs: PlaidLiabilities | null = null;
    if (products.includes("liabilities") && accounts.some((a) => isPlaidLiability(a.type))) {
      try {
        liabs = (await getLiabilities(token)).liabilities;
        result.liabilities = true;
      } catch (e) {
        result.warnings.push(`Liabilities unavailable: ${e instanceof PlaidError ? e.code : "error"}`);
      }
    }

    const { data: existingRows } = await supabase.from("financial_accounts").select("*").eq("user_id", userId).eq("external_provider", "plaid");
    const existing = new Map(((existingRows ?? []) as FinancialAccount[]).map((a) => [a.external_account_id as string, a]));
    const accountIdByExternal = new Map<string, { id: string; type: FinancialAccount["account_type"] }>();
    const seen = new Set<string>();

    for (const pa of accounts) {
      result.accounts_seen++;
      seen.add(pa.account_id);
      const type = mapAccountType(pa.type, pa.subtype);
      const balance = mapBalance(pa.type, pa.balances);
      const liab = liabilityFor(liabs, pa.account_id);
      const prev = existing.get(pa.account_id);
      const common: Record<string, unknown> = {
        balance,
        available_balance: pa.balances.available,
        external_subtype: pa.subtype,
        external_mask: pa.mask,
        official_name: pa.official_name,
        plaid_item_id: item.item_id,
        last_synced_at: now,
        sync_error: null,
        is_archived: false,
      };
      if (liab.rate != null) common.interest_rate = liab.rate;
      if (liab.minimum != null) common.minimum_payment = liab.minimum;
      if (prev) {
        const changed = Math.abs(Number(prev.balance) - balance) > 0.005;
        if (changed) common.last_updated = today;
        const { error } = await supabase.from("financial_accounts").update(common).eq("id", prev.id);
        if (error) throw new Error(error.message);
        if (changed) await supabase.from("financial_balance_snapshots").upsert({ user_id: userId, account_id: prev.id, snapshot_date: today, balance }, { onConflict: "account_id,snapshot_date" });
        accountIdByExternal.set(pa.account_id, { id: prev.id, type: prev.account_type });
        result.accounts_updated++;
        if (isPlaidLiability(pa.type)) {
          const { data: debt } = await supabase.from("financial_debts").select("id").eq("account_id", prev.id).maybeSingle();
          if (!debt) await supabase.from("financial_debts").insert({ user_id: userId, account_id: prev.id, actual_payment: liab.minimum ?? 0, original_balance: liab.original ?? balance });
        }
      } else {
        const { data: created, error } = await supabase
          .from("financial_accounts")
          .insert({
            user_id: userId,
            name: displayName(pa, item.institution_name),
            account_type: type,
            institution: item.institution_name,
            monthly_contribution: 0,
            include_in_net_worth: true,
            external_provider: "plaid",
            external_account_id: pa.account_id,
            last_updated: today,
            ...common,
          })
          .select("id")
          .single();
        if (error || !created) throw new Error(error?.message ?? "Could not create account");
        const id = created.id as string;
        await supabase.from("financial_balance_snapshots").upsert({ user_id: userId, account_id: id, snapshot_date: today, balance }, { onConflict: "account_id,snapshot_date" });
        if (isPlaidLiability(pa.type)) await supabase.from("financial_debts").insert({ user_id: userId, account_id: id, actual_payment: liab.minimum ?? 0, original_balance: liab.original ?? balance });
        accountIdByExternal.set(pa.account_id, { id, type });
        result.accounts_created++;
      }
    }
    // Accounts this Item used to report but no longer does (closed at the bank).
    for (const [ext, row] of existing) {
      if (row.plaid_item_id === item.item_id && !seen.has(ext)) {
        await supabase.from("financial_accounts").update({ sync_error: "No longer reported by the bank", last_synced_at: now }).eq("id", row.id);
      }
    }

    let cursor = item.transactions_cursor ?? null;
    if (opts.transactions !== false && products.includes("transactions")) {
      const { data: catRows } = await supabase.from("financial_budget_categories").select("id,plaid_categories").eq("user_id", userId).eq("is_archived", false);
      const categories = (catRows ?? []) as { id: string; plaid_categories: string[] }[];
      const toRow = (t: PlaidTransaction) => {
        const acc = accountIdByExternal.get(t.account_id);
        if (!acc) return null;
        const mapped = mapTransaction(t, acc.type);
        return {
          user_id: userId,
          account_id: acc.id,
          plaid_item_id: item.item_id,
          external_id: t.transaction_id,
          transaction_date: t.date,
          description: t.name,
          merchant_name: t.merchant_name ?? null,
          category_primary: t.personal_finance_category?.primary ?? null,
          category_detailed: t.personal_finance_category?.detailed ?? null,
          category_id: matchBudgetCategory(categories, t.personal_finance_category?.primary ?? null, t.personal_finance_category?.detailed ?? null),
          pending: t.pending,
          amount: mapped.amount,
          transaction_type: mapped.transaction_type,
        };
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const added: PlaidTransaction[] = [];
        const modified: PlaidTransaction[] = [];
        const removed: string[] = [];
        let next = cursor;
        try {
          for (;;) {
            const page = await syncTransactionsPage(token, next);
            added.push(...page.added);
            modified.push(...page.modified);
            removed.push(...page.removed.map((r) => r.transaction_id));
            next = page.next_cursor;
            if (!page.has_more) break;
          }
        } catch (e) {
          if (e instanceof PlaidError && e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt === 0) continue;
          if (e instanceof PlaidError && e.code === "PRODUCT_NOT_READY") {
            result.warnings.push("Transactions are still being prepared by Plaid; they arrive via webhook.");
            break;
          }
          throw e;
        }
        const rows = [...added, ...modified].map(toRow).filter((r): r is NonNullable<typeof r> => r !== null);
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await supabase.from("financial_transactions").upsert(rows.slice(i, i + 200), { onConflict: "account_id,external_id" });
          if (error) throw new Error(error.message);
        }
        if (removed.length) {
          for (let i = 0; i < removed.length; i += 200) await supabase.from("financial_transactions").delete().eq("user_id", userId).in("external_id", removed.slice(i, i + 200));
        }
        result.transactions_added += added.length;
        result.transactions_modified += modified.length;
        result.transactions_removed += removed.length;
        cursor = next;
        break;
      }
    }

    await markItem(supabase, item, { status: "active", error_code: null, error_message: null, last_synced_at: now, transactions_cursor: cursor, products });
    await finish("success");
    return result;
  } catch (e) {
    const msg = await recordItemError(supabase, item, e);
    await finish("error", msg);
    throw e instanceof Error ? e : new Error(msg);
  }
}

/** Syncs every connection of one user (manual) or every syncable connection (cron). */
export async function syncItems(supabase: Client, items: PlaidItem[], opts: SyncOptions): Promise<{ item: PlaidItem; ok: boolean; result?: PlaidSyncResult; error?: string }[]> {
  const out: { item: PlaidItem; ok: boolean; result?: PlaidSyncResult; error?: string }[] = [];
  for (const item of items) {
    try {
      out.push({ item, ok: true, result: await runPlaidSync(supabase, item, opts) });
    } catch (e) {
      out.push({ item, ok: false, error: e instanceof Error ? e.message : "Sync failed" });
    }
  }
  return out;
}
