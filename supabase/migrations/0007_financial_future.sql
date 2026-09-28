-- Financial Future module: accounts, debts, balance history, goals, scenarios, milestones, budget, transactions.
-- Money is numeric(14,2) in USD. Dates are date-only. Every table is user-owned and protected by RLS.
-- Bank credentials are never stored: future aggregation (Plaid etc.) keeps only provider + external ids here.

create table public.financial_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_income numeric(12,2) not null default 0,             -- net take-home per month
  income_growth_pct numeric(5,2) not null default 3,           -- expected annual raise, %
  fixed_expenses numeric(12,2) not null default 0,             -- rent, insurance, subscriptions… (excluding debt payments)
  variable_expenses numeric(12,2) not null default 0,          -- food, fuel, fun…
  investment_return_pct numeric(5,2) not null default 7,       -- expected annual return on brokerage/retirement, %
  savings_apy_pct numeric(5,2) not null default 4,             -- yield on savings accounts, %
  emergency_fund_months numeric(4,1) not null default 6,
  surplus_destination text not null default 'checking' check (surplus_destination in ('checking', 'savings', 'investing')),
  debt_strategy text not null default 'avalanche' check (debt_strategy in ('minimum', 'avalanche', 'snowball', 'custom')),
  extra_debt_payment numeric(12,2) not null default 0,         -- monthly amount beyond minimums, applied by strategy
  assumptions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.financial_profiles enable row level security;
create policy "financial_profiles: owner all" on public.financial_profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger financial_profiles_set_updated_at before update on public.financial_profiles for each row execute function public.set_updated_at();

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  account_type text not null check (account_type in ('checking', 'savings', 'credit_card', 'student_loan', 'auto_loan', 'other_loan', 'brokerage', 'retirement', 'other_asset', 'other_liability')),
  institution text,
  balance numeric(14,2) not null default 0,                    -- assets: value; liabilities: amount owed (positive)
  interest_rate numeric(6,3),                                  -- APR (liabilities) or APY / expected growth (assets), %
  minimum_payment numeric(12,2),                               -- liabilities
  monthly_contribution numeric(12,2) not null default 0,       -- assets: planned monthly deposit
  include_in_net_worth boolean not null default true,
  external_provider text,                                      -- e.g. 'plaid' (tokens live server-side, never here)
  external_account_id text,
  notes text,
  last_updated date not null default current_date,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_accounts_user_idx on public.financial_accounts (user_id, account_type);
alter table public.financial_accounts enable row level security;
create policy "financial_accounts: owner all" on public.financial_accounts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger financial_accounts_set_updated_at before update on public.financial_accounts for each row execute function public.set_updated_at();

-- Debt details extend a liability account (balance, APR and minimum live on the account).
create table public.financial_debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null unique references public.financial_accounts(id) on delete cascade,
  original_balance numeric(14,2),
  actual_payment numeric(12,2) not null default 0,             -- what you actually pay per month
  custom_order integer not null default 0,                     -- for the custom payoff strategy
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_debts_user_idx on public.financial_debts (user_id, custom_order);
alter table public.financial_debts enable row level security;
create policy "financial_debts: owner all" on public.financial_debts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger financial_debts_set_updated_at before update on public.financial_debts for each row execute function public.set_updated_at();

-- Balance history for net worth over time (one row per account per day, written on every balance update).
create table public.financial_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.financial_accounts(id) on delete cascade,
  snapshot_date date not null,
  balance numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique (account_id, snapshot_date)
);
create index financial_balance_snapshots_user_idx on public.financial_balance_snapshots (user_id, snapshot_date);
alter table public.financial_balance_snapshots enable row level security;
create policy "financial_balance_snapshots: owner all" on public.financial_balance_snapshots for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.financial_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  category text not null check (category in ('emergency_fund', 'debt_payoff', 'education', 'home', 'vehicle', 'net_worth', 'retirement', 'wedding', 'travel', 'savings', 'other')),
  target_amount numeric(14,2) not null default 0,
  current_amount numeric(14,2) not null default 0,             -- manual progress unless linked_account_id is set
  linked_account_id uuid references public.financial_accounts(id) on delete set null,  -- savings goal tracks an asset; payoff goal tracks a liability
  target_date date,
  priority integer not null default 0,                         -- rank (0 = top)
  monthly_contribution numeric(12,2) not null default 0,       -- planned contribution toward this goal
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  linked_project_id uuid references public.projects(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index financial_goals_user_idx on public.financial_goals (user_id, status, priority);
create index financial_goals_project_idx on public.financial_goals (linked_project_id);
create index financial_goals_account_idx on public.financial_goals (linked_account_id);
alter table public.financial_goals enable row level security;
create policy "financial_goals: owner all" on public.financial_goals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger financial_goals_set_updated_at before update on public.financial_goals for each row execute function public.set_updated_at();

create table public.financial_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  description text,
  assumptions jsonb not null default '{"changes": []}'::jsonb,  -- list of typed changes applied on top of the baseline
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_scenarios_user_idx on public.financial_scenarios (user_id, created_at desc);
alter table public.financial_scenarios enable row level security;
create policy "financial_scenarios: owner all" on public.financial_scenarios for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger financial_scenarios_set_updated_at before update on public.financial_scenarios for each row execute function public.set_updated_at();

create table public.financial_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  milestone_type text not null default 'custom' check (milestone_type in ('goal', 'life_event', 'debt_free', 'net_worth', 'custom')),
  target_date date,
  projected_date date,                                         -- cached from the projection engine
  amount numeric(14,2),                                        -- e.g. net worth threshold or cost of the life event
  linked_goal_id uuid references public.financial_goals(id) on delete cascade,
  linked_event_id uuid references public.events(id) on delete set null,
  is_done boolean not null default false,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_milestones_user_idx on public.financial_milestones (user_id, target_date);
create index financial_milestones_goal_idx on public.financial_milestones (linked_goal_id);
create index financial_milestones_event_idx on public.financial_milestones (linked_event_id);
alter table public.financial_milestones enable row level security;
create policy "financial_milestones: owner all" on public.financial_milestones for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger financial_milestones_set_updated_at before update on public.financial_milestones for each row execute function public.set_updated_at();

create table public.financial_budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null default 'expense' check (kind in ('expense', 'debt', 'savings', 'investing')),
  budgeted numeric(12,2) not null default 0,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create index financial_budget_categories_user_idx on public.financial_budget_categories (user_id, sort_order);
alter table public.financial_budget_categories enable row level security;
create policy "financial_budget_categories: owner all" on public.financial_budget_categories for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.financial_budget_actuals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.financial_budget_categories(id) on delete cascade,
  month date not null,                                         -- first day of the month
  actual numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, month)
);
create index financial_budget_actuals_user_idx on public.financial_budget_actuals (user_id, month);
alter table public.financial_budget_actuals enable row level security;
create policy "financial_budget_actuals: owner all" on public.financial_budget_actuals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger financial_budget_actuals_set_updated_at before update on public.financial_budget_actuals for each row execute function public.set_updated_at();

-- Transactions: schema in place for phase 2 (manual entry / provider import); not required by phase 1 screens.
create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.financial_accounts(id) on delete cascade,
  transaction_date date not null,
  description text,
  category_id uuid references public.financial_budget_categories(id) on delete set null,
  amount numeric(14,2) not null,                               -- positive = money in, negative = money out
  transaction_type text not null default 'expense' check (transaction_type in ('income', 'expense', 'transfer', 'payment', 'contribution')),
  external_id text,
  created_at timestamptz not null default now(),
  unique (account_id, external_id)
);
create index financial_transactions_user_idx on public.financial_transactions (user_id, transaction_date desc);
create index financial_transactions_account_idx on public.financial_transactions (account_id, transaction_date desc);
create index financial_transactions_category_idx on public.financial_transactions (category_id);
alter table public.financial_transactions enable row level security;
create policy "financial_transactions: owner all" on public.financial_transactions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
