-- Recurring income, expenses, debt payments and savings transfers.
-- Each row is one predictable money movement; the projection reads the monthly equivalents
-- through the profile (Recurring → "Use in projection"), and transactions are matched to rows
-- by a case-insensitive substring of the bank description (`match_pattern`, `|` separates alternatives).

create table public.financial_recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null default 'expense' check (kind in ('income', 'expense', 'debt', 'savings', 'investing')),
  amount numeric(12,2) not null default 0 check (amount >= 0),         -- per occurrence
  cadence text not null default 'monthly' check (cadence in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'yearly')),
  next_date date,                                                      -- next expected occurrence
  account_id uuid references public.financial_accounts(id) on delete set null,
  category_id uuid references public.financial_budget_categories(id) on delete set null,
  match_pattern text check (match_pattern is null or length(match_pattern) <= 200),
  is_variable boolean not null default false,                          -- amount changes from one occurrence to the next
  in_projection boolean not null default true,                         -- counted by "Use in projection"
  is_active boolean not null default true,
  notes text check (notes is null or length(notes) <= 5000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_recurring_user_idx on public.financial_recurring (user_id, kind, sort_order);
create index financial_recurring_account_idx on public.financial_recurring (account_id);
alter table public.financial_recurring enable row level security;
create policy "financial_recurring: owner all" on public.financial_recurring for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger financial_recurring_set_updated_at before update on public.financial_recurring for each row execute function public.set_updated_at();

-- Manual imports and entries carry a source tag so they can be told apart from Plaid rows.
alter table public.financial_transactions add column if not exists source text not null default 'manual' check (source in ('manual', 'import', 'plaid'));
update public.financial_transactions set source = 'plaid' where plaid_item_id is not null and source = 'manual';
