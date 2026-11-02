-- Direct strap reading over Bluetooth, no WHOOP cloud. The phone or browser offloads the strap's own
-- history, aggregates it to one row per minute and stores it here; sleep, resting heart rate, HRV,
-- respiratory rate, strain and workouts are then derived into the health_* tables with source 'ble'.
-- Safe to re-run.

-- The developer-API tables from an earlier draft are no longer used.
drop table if exists public.whoop_webhook_events;
drop table if exists public.whoop_records;
drop table if exists public.whoop_connections;

create table if not exists public.strap_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  serial text not null check (length(serial) <= 40),
  name text check (name is null or length(name) <= 80),
  model text not null default 'auto' check (model in ('auto', 'whoop4', 'whoop5')),
  firmware text check (firmware is null or length(firmware) <= 80),
  battery_pct numeric(5,1),
  max_hr integer check (max_hr is null or max_hr between 100 and 230),
  last_seen_at timestamptz,
  last_offload_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, serial)
);
alter table public.strap_devices enable row level security;
drop policy if exists "strap_devices: owner all" on public.strap_devices;
create policy "strap_devices: owner all" on public.strap_devices for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create or replace trigger strap_devices_set_updated_at before update on public.strap_devices for each row execute function public.set_updated_at();

create table if not exists public.strap_minutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  minute timestamptz not null,
  hr_avg numeric(5,1),
  hr_min integer,
  hr_max integer,
  rr jsonb not null default '[]'::jsonb,            -- R-R intervals in ms, at most 200 per minute
  motion numeric(8,4),                               -- mean |delta gravity| per second, g
  skin_contact numeric(4,3),                         -- share of samples with contact
  raw_skin_temp numeric(10,2),                       -- uncalibrated ADC
  raw_spo2 jsonb,                                    -- { red, ir } uncalibrated
  raw_resp numeric(10,2),                            -- uncalibrated
  samples integer not null default 0,
  primary key (user_id, minute),
  check (pg_column_size(rr) <= 4096)
);
alter table public.strap_minutes enable row level security;
drop policy if exists "strap_minutes: owner all" on public.strap_minutes;
create policy "strap_minutes: owner all" on public.strap_minutes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.strap_offloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  serial text,
  platform text check (platform is null or platform in ('ios', 'android', 'web')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'aborted')),
  records integer not null default 0,
  chunks integer not null default 0,
  minutes integer not null default 0,
  first_sample_at timestamptz,
  last_sample_at timestamptz,
  error text,
  log jsonb
);
create index if not exists strap_offloads_user_started_idx on public.strap_offloads (user_id, started_at desc);
alter table public.strap_offloads enable row level security;
drop policy if exists "strap_offloads: owner all" on public.strap_offloads;
create policy "strap_offloads: owner all" on public.strap_offloads for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
