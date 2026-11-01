-- Health module: daily recovery, strain, HRV and sleep imported from a WHOOP data export or a NOOP
-- CSV export (NOOP is the offline WHOOP companion app; its export uses the WHOOP layout). Rows are
-- keyed by local day or session start so re-importing the same export is an upsert, never a duplicate.
-- Every table is user-owned and protected by RLS. No device credentials are stored anywhere.
-- Safe to re-run: every statement skips or replaces what already exists.

create table if not exists public.health_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  recovery numeric(5,1),                 -- 0..100
  strain numeric(5,2),                   -- WHOOP day strain, 0..21
  resting_hr integer,                    -- bpm
  hrv_ms numeric(6,1),
  spo2_pct numeric(5,1),
  skin_temp_c numeric(5,2),
  resp_rate numeric(5,2),                -- breaths per minute
  energy_kcal numeric(8,1),
  max_hr integer,
  avg_hr integer,
  sleep_performance_pct numeric(5,1),
  sleep_total_min numeric(7,1),
  in_bed_min numeric(7,1),
  light_min numeric(7,1),
  deep_min numeric(7,1),
  rem_min numeric(7,1),
  awake_min numeric(7,1),
  sleep_efficiency_pct numeric(5,1),
  sleep_consistency_pct numeric(5,1),
  sleep_need_min numeric(7,1),
  sleep_debt_min numeric(7,1),
  source text not null default 'whoop' check (length(source) <= 40),   -- 'whoop', 'import', 'noop (APPROXIMATE)' …
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists health_days_user_day_idx on public.health_days (user_id, day desc);
alter table public.health_days enable row level security;
drop policy if exists "health_days: owner all" on public.health_days;
create policy "health_days: owner all" on public.health_days for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create or replace trigger health_days_set_updated_at before update on public.health_days for each row execute function public.set_updated_at();

create table if not exists public.health_sleeps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  day date not null,                     -- the cycle (wake) day the sleep belongs to
  nap boolean not null default false,
  performance_pct numeric(5,1),
  resp_rate numeric(5,2),
  asleep_min numeric(7,1),
  in_bed_min numeric(7,1),
  light_min numeric(7,1),
  deep_min numeric(7,1),
  rem_min numeric(7,1),
  awake_min numeric(7,1),
  efficiency_pct numeric(5,1),
  consistency_pct numeric(5,1),
  need_min numeric(7,1),
  debt_min numeric(7,1),
  source text not null default 'whoop' check (length(source) <= 40),
  created_at timestamptz not null default now(),
  unique (user_id, start_at)
);
create index if not exists health_sleeps_user_day_idx on public.health_sleeps (user_id, day desc);
alter table public.health_sleeps enable row level security;
drop policy if exists "health_sleeps: owner all" on public.health_sleeps;
create policy "health_sleeps: owner all" on public.health_sleeps for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.health_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  day date not null,
  activity text not null check (length(trim(activity)) between 1 and 80),
  strain numeric(5,2),
  energy_kcal numeric(8,1),
  max_hr integer,
  avg_hr integer,
  zone1_pct numeric(5,1),
  zone2_pct numeric(5,1),
  zone3_pct numeric(5,1),
  zone4_pct numeric(5,1),
  zone5_pct numeric(5,1),
  distance_m numeric(10,1),
  source text not null default 'whoop' check (length(source) <= 40),
  created_at timestamptz not null default now(),
  unique (user_id, start_at, activity)
);
create index if not exists health_workouts_user_day_idx on public.health_workouts (user_id, day desc);
alter table public.health_workouts enable row level security;
drop policy if exists "health_workouts: owner all" on public.health_workouts;
create policy "health_workouts: owner all" on public.health_workouts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.health_journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  question text not null check (length(trim(question)) between 1 and 200),
  answered_yes boolean not null default false,
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  unique (user_id, day, question)
);
create index if not exists health_journal_user_day_idx on public.health_journal (user_id, day desc);
alter table public.health_journal enable row level security;
drop policy if exists "health_journal: owner all" on public.health_journal;
create policy "health_journal: owner all" on public.health_journal for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.health_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null check (length(filename) <= 200),
  source text not null check (source in ('whoop', 'noop')),
  days integer not null default 0,
  sleeps integer not null default 0,
  workouts integer not null default 0,
  journal integer not null default 0,
  first_day date,
  last_day date,
  created_at timestamptz not null default now()
);
create index if not exists health_imports_user_idx on public.health_imports (user_id, created_at desc);
alter table public.health_imports enable row level security;
drop policy if exists "health_imports: owner all" on public.health_imports;
create policy "health_imports: owner all" on public.health_imports for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
