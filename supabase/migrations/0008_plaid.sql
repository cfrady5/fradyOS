-- Plaid bank connections. Bank credentials never touch this database: Plaid holds them and hands the
-- app an access token per institution ("Item"). Tokens are encrypted with PLAID_TOKEN_ENCRYPTION_KEY
-- and stored in plaid_item_secrets, which has RLS enabled and NO policies: only the service-role key
-- used on the server can read or write it. Users see connection metadata in plaid_items only.

create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null unique,
  institution_id text,
  institution_name text,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  status text not null default 'active' check (status in ('active', 'error', 'reauth_required', 'disconnected')),
  error_code text,
  error_message text,
  products text[] not null default '{}',
  transactions_cursor text,
  last_synced_at timestamptz,
  last_webhook_at timestamptz,
  consent_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plaid_items_user_idx on public.plaid_items (user_id);
alter table public.plaid_items enable row level security;
create policy "plaid_items: owner read" on public.plaid_items for select to authenticated using ((select auth.uid()) = user_id);
create trigger plaid_items_set_updated_at before update on public.plaid_items for each row execute function public.set_updated_at();

create table public.plaid_item_secrets (
  item_id text primary key references public.plaid_items(item_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plaid_item_secrets enable row level security;
revoke all on table public.plaid_item_secrets from anon, authenticated;
create trigger plaid_item_secrets_set_updated_at before update on public.plaid_item_secrets for each row execute function public.set_updated_at();

create table public.plaid_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text references public.plaid_items(item_id) on delete cascade,
  trigger text not null check (trigger in ('link', 'manual', 'scheduled', 'webhook')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  result jsonb,
  error text
);
create index plaid_sync_runs_user_idx on public.plaid_sync_runs (user_id, started_at desc);
create index plaid_sync_runs_item_idx on public.plaid_sync_runs (item_id);
alter table public.plaid_sync_runs enable row level security;
create policy "plaid_sync_runs: owner read" on public.plaid_sync_runs for select to authenticated using ((select auth.uid()) = user_id);

-- Accounts gain the link back to the Item plus the live fields Plaid reports.
alter table public.financial_accounts add column if not exists plaid_item_id text references public.plaid_items(item_id) on delete set null;
alter table public.financial_accounts add column if not exists external_subtype text;
alter table public.financial_accounts add column if not exists external_mask text;
alter table public.financial_accounts add column if not exists official_name text;
alter table public.financial_accounts add column if not exists available_balance numeric(14,2);
alter table public.financial_accounts add column if not exists last_synced_at timestamptz;
alter table public.financial_accounts add column if not exists sync_error text;
create unique index if not exists financial_accounts_external_uidx on public.financial_accounts (user_id, external_provider, external_account_id) where external_account_id is not null;
create index if not exists financial_accounts_plaid_item_idx on public.financial_accounts (plaid_item_id);

-- Transactions gain Plaid's enrichment. amount keeps the app convention: positive = money in.
alter table public.financial_transactions add column if not exists pending boolean not null default false;
alter table public.financial_transactions add column if not exists merchant_name text;
alter table public.financial_transactions add column if not exists category_primary text;
alter table public.financial_transactions add column if not exists category_detailed text;
alter table public.financial_transactions add column if not exists plaid_item_id text references public.plaid_items(item_id) on delete set null;
alter table public.financial_transactions add column if not exists updated_at timestamptz not null default now();
create index if not exists financial_transactions_item_idx on public.financial_transactions (plaid_item_id);
create trigger financial_transactions_set_updated_at before update on public.financial_transactions for each row execute function public.set_updated_at();

-- Budget categories map to Plaid personal-finance categories (primary or detailed prefixes).
alter table public.financial_budget_categories add column if not exists plaid_categories text[] not null default '{}';
update public.financial_budget_categories set plaid_categories = case name
  when 'Housing' then array['RENT_AND_UTILITIES_RENT']
  when 'Utilities' then array['RENT_AND_UTILITIES']
  when 'Transportation' then array['TRANSPORTATION']
  when 'Food' then array['FOOD_AND_DRINK_GROCERIES']
  when 'Restaurants' then array['FOOD_AND_DRINK']
  when 'Entertainment' then array['ENTERTAINMENT']
  when 'Shopping' then array['GENERAL_MERCHANDISE']
  when 'Insurance' then array['GENERAL_SERVICES_INSURANCE']
  when 'Debt payments' then array['LOAN_PAYMENTS']
  when 'Travel' then array['TRAVEL']
  when 'Other' then array['MEDICAL', 'PERSONAL_CARE', 'GENERAL_SERVICES', 'HOME_IMPROVEMENT', 'GOVERNMENT_AND_NON_PROFIT', 'BANK_FEES']
  else plaid_categories end
where plaid_categories = '{}';
