-- Live heart-rate sessions read straight from the strap over Bluetooth (standard Heart Rate
-- Service, no bond, so the strap stays paired to the WHOOP app). Samples are kept as a compact
-- JSON array of [offsetSeconds, bpm, [rrMs...]] so a session is one row.
-- Safe to re-run: every statement skips or replaces what already exists.

create table if not exists public.health_live_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  device_name text check (device_name is null or length(device_name) <= 80),
  sample_count integer not null default 0,
  avg_hr integer,
  max_hr integer,
  min_hr integer,
  rmssd_ms numeric(6,1),
  samples jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check (end_at >= start_at),
  check (pg_column_size(samples) <= 2 * 1024 * 1024)
);
create index if not exists health_live_sessions_user_start_idx on public.health_live_sessions (user_id, start_at desc);
alter table public.health_live_sessions enable row level security;
drop policy if exists "health_live_sessions: owner all" on public.health_live_sessions;
create policy "health_live_sessions: owner all" on public.health_live_sessions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
