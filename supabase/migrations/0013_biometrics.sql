-- Health Intelligence: the unified biometric model, baselines, detections, derived scores,
-- correlations, insights, rules, preferences, processing jobs, source capabilities, behaviour logs
-- and the WHOOP developer-API connection. Every user-scoped table is owner-only under RLS.
-- Safe to re-run: every statement skips or replaces what already exists.

create table if not exists public.biometric_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric text not null check (length(metric) <= 40),
  day date not null,
  value numeric(12,3),
  unit text not null default '' check (length(unit) <= 16),
  period_start timestamptz,
  period_end timestamptz,
  provider text not null check (provider in ('whoop_api', 'whoop_export', 'noop_export', 'ble', 'manual')),
  source_field text check (source_field is null or length(source_field) <= 80),
  source_record_id text check (source_record_id is null or length(source_record_id) <= 120),
  measurement_type text not null default 'daily' check (measurement_type in ('daily', 'sleep', 'workout', 'session', 'body')),
  availability text not null default 'available' check (availability in ('available', 'missing', 'unscored', 'pending')),
  quality text not null default 'ok' check (quality in ('ok', 'suspect', 'invalid')),
  synced_at timestamptz not null default now(),
  algorithm_version text,
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  unique (user_id, provider, metric, day)
);
create index if not exists biometric_measurements_user_metric_day_idx on public.biometric_measurements (user_id, metric, day desc);
alter table public.biometric_measurements enable row level security;
drop policy if exists "biometric_measurements: owner all" on public.biometric_measurements;
create policy "biometric_measurements: owner all" on public.biometric_measurements for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.biometric_daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  provider text check (provider is null or provider in ('whoop_api', 'whoop_export', 'noop_export', 'ble', 'manual')),
  values jsonb not null default '{}'::jsonb,          -- { metric: number | null }
  completeness numeric(4,3) not null default 0,
  scored boolean not null default true,
  algorithm_version text not null,
  computed_at timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists biometric_daily_summaries_user_day_idx on public.biometric_daily_summaries (user_id, day desc);
alter table public.biometric_daily_summaries enable row level security;
drop policy if exists "biometric_daily_summaries: owner all" on public.biometric_daily_summaries;
create policy "biometric_daily_summaries: owner all" on public.biometric_daily_summaries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.biometric_baselines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric text not null check (length(metric) <= 40),
  as_of date not null,
  version integer not null default 1,
  sample_n integer not null default 0,
  ready boolean not null default false,
  stats jsonb not null default '{}'::jsonb,           -- the Baseline object
  computed_at timestamptz not null default now(),
  unique (user_id, metric, as_of, version)
);
create index if not exists biometric_baselines_user_metric_idx on public.biometric_baselines (user_id, metric, as_of desc);
alter table public.biometric_baselines enable row level security;
drop policy if exists "biometric_baselines: owner all" on public.biometric_baselines;
create policy "biometric_baselines: owner all" on public.biometric_baselines for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.biometric_detected_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_key text not null check (length(rule_key) <= 80),
  engine text not null check (length(engine) <= 20),
  kind text not null check (kind in ('deviation', 'trend', 'pattern', 'correlation', 'status')),
  metric text check (metric is null or length(metric) <= 40),
  day date not null,
  severity text not null check (severity in ('info', 'low', 'moderate', 'high')),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  title text not null check (length(title) <= 200),
  value numeric(12,3),
  baseline numeric(12,3),
  delta numeric(12,3),
  delta_pct numeric(8,2),
  method text not null check (length(method) <= 120),
  completeness numeric(4,3) not null default 0,
  explanation text not null check (length(explanation) <= 2000),
  next_step text not null check (length(next_step) <= 1000),
  evidence jsonb,
  algorithm_version text not null,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  dismissed_at timestamptz,
  unique (user_id, rule_key, day)
);
create index if not exists biometric_detected_events_user_status_idx on public.biometric_detected_events (user_id, status, severity, day desc);
alter table public.biometric_detected_events enable row level security;
drop policy if exists "biometric_detected_events: owner all" on public.biometric_detected_events;
create policy "biometric_detected_events: owner all" on public.biometric_detected_events for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.biometric_derived_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (key in ('sleep_quality_index', 'readiness', 'physiological_load', 'health_trend')),
  day date not null,
  value numeric(6,2),
  formula_version text not null,
  factors jsonb not null default '[]'::jsonb,
  completeness numeric(4,3) not null default 0,
  note text,
  computed_at timestamptz not null default now(),
  unique (user_id, key, day)
);
create index if not exists biometric_derived_metrics_user_key_day_idx on public.biometric_derived_metrics (user_id, key, day desc);
alter table public.biometric_derived_metrics enable row level security;
drop policy if exists "biometric_derived_metrics: owner all" on public.biometric_derived_metrics;
create policy "biometric_derived_metrics: owner all" on public.biometric_derived_metrics for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.biometric_correlations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (length(key) <= 120),
  x_label text not null,
  y_label text not null,
  lag_days integer not null default 0,
  method text not null,
  sample_n integer not null,
  r numeric(6,4),
  ci_low numeric(6,4),
  ci_high numeric(6,4),
  diff numeric(12,3),
  diff_ci_low numeric(12,3),
  diff_ci_high numeric(12,3),
  period_start date,
  period_end date,
  detail jsonb,
  computed_at timestamptz not null default now(),
  unique (user_id, key)
);
alter table public.biometric_correlations enable row level security;
drop policy if exists "biometric_correlations: owner all" on public.biometric_correlations;
create policy "biometric_correlations: owner all" on public.biometric_correlations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.biometric_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (length(key) <= 120),
  day date not null,
  rank integer not null default 0,
  category text not null check (length(category) <= 20),
  severity text not null check (severity in ('info', 'low', 'moderate', 'high')),
  title text not null check (length(title) <= 200),
  body text not null check (length(body) <= 2000),
  recommendation text,
  href text,
  confidence numeric(4,3),
  evidence jsonb,
  generated_at timestamptz not null default now(),
  unique (user_id, key, day)
);
create index if not exists biometric_insights_user_day_rank_idx on public.biometric_insights (user_id, day desc, rank);
alter table public.biometric_insights enable row level security;
drop policy if exists "biometric_insights: owner all" on public.biometric_insights;
create policy "biometric_insights: owner all" on public.biometric_insights for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.biometric_detection_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_key text not null check (length(rule_key) <= 80),
  enabled boolean not null default true,
  thresholds jsonb not null default '{}'::jsonb,
  algorithm_version text,
  updated_at timestamptz not null default now(),
  unique (user_id, rule_key)
);
alter table public.biometric_detection_rules enable row level security;
drop policy if exists "biometric_detection_rules: owner all" on public.biometric_detection_rules;
create policy "biometric_detection_rules: owner all" on public.biometric_detection_rules for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.biometric_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  in_app boolean not null default true,
  email boolean not null default false,
  push boolean not null default false,
  min_severity text not null default 'moderate' check (min_severity in ('info', 'low', 'moderate', 'high')),
  z_moderate numeric(4,2) not null default 2.0 check (z_moderate between 1 and 4),
  persist_days integer not null default 3 check (persist_days between 2 and 7),
  updated_at timestamptz not null default now()
);
alter table public.biometric_notification_preferences enable row level security;
drop policy if exists "biometric_notification_preferences: owner all" on public.biometric_notification_preferences;
create policy "biometric_notification_preferences: owner all" on public.biometric_notification_preferences for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.biometric_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('recompute', 'import', 'whoop_sync', 'whoop_webhook', 'scheduled')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  window_start date,
  window_end date,
  attempts integer not null default 1,
  stats jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists biometric_processing_jobs_user_started_idx on public.biometric_processing_jobs (user_id, started_at desc);
alter table public.biometric_processing_jobs enable row level security;
drop policy if exists "biometric_processing_jobs: owner all" on public.biometric_processing_jobs;
create policy "biometric_processing_jobs: owner all" on public.biometric_processing_jobs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Global registry: which provider exposes which metric. Readable by every signed-in user.
create table if not exists public.biometric_source_capabilities (
  provider text not null,
  metric text not null,
  available boolean not null default true,
  notes text,
  primary key (provider, metric)
);
alter table public.biometric_source_capabilities enable row level security;
drop policy if exists "biometric_source_capabilities: read" on public.biometric_source_capabilities;
create policy "biometric_source_capabilities: read" on public.biometric_source_capabilities for select to authenticated using (true);
insert into public.biometric_source_capabilities (provider, metric, available, notes) values
  ('whoop_export', 'recovery_score', true, null), ('whoop_export', 'resting_hr', true, null), ('whoop_export', 'hrv_rmssd', true, null),
  ('whoop_export', 'spo2', true, null), ('whoop_export', 'skin_temp', true, null), ('whoop_export', 'resp_rate', true, null),
  ('whoop_export', 'day_strain', true, null), ('whoop_export', 'avg_hr', true, null), ('whoop_export', 'max_hr', true, null),
  ('whoop_export', 'energy_kcal', true, null), ('whoop_export', 'steps', false, 'Not in the WHOOP data export'),
  ('whoop_export', 'sleep_total_min', true, null), ('whoop_export', 'in_bed_min', true, null), ('whoop_export', 'awake_min', true, null),
  ('whoop_export', 'light_min', true, null), ('whoop_export', 'deep_min', true, null), ('whoop_export', 'rem_min', true, null),
  ('whoop_export', 'sleep_cycles', false, 'Not in the WHOOP data export'), ('whoop_export', 'disturbances', false, 'Not in the WHOOP data export'),
  ('whoop_export', 'sleep_efficiency', true, null), ('whoop_export', 'sleep_performance', true, null), ('whoop_export', 'sleep_consistency', true, null),
  ('whoop_export', 'sleep_need_min', true, null), ('whoop_export', 'sleep_debt_min', true, null), ('whoop_export', 'sleep_onset_min', true, null),
  ('whoop_export', 'wake_min', true, null), ('whoop_export', 'nap_min', true, null), ('whoop_export', 'nap_count', true, null),
  ('whoop_export', 'workout_count', true, null), ('whoop_export', 'workout_min', true, null), ('whoop_export', 'workout_strain', true, null),
  ('whoop_export', 'workout_avg_hr', true, null), ('whoop_export', 'workout_max_hr', true, null), ('whoop_export', 'workout_kcal', true, null),
  ('whoop_api', 'recovery_score', true, 'recovery.score.recovery_score'), ('whoop_api', 'resting_hr', true, 'recovery.score.resting_heart_rate'),
  ('whoop_api', 'hrv_rmssd', true, 'recovery.score.hrv_rmssd_milli'), ('whoop_api', 'spo2', true, 'recovery.score.spo2_percentage'),
  ('whoop_api', 'skin_temp', true, 'recovery.score.skin_temp_celsius'), ('whoop_api', 'resp_rate', true, 'sleep.score.respiratory_rate'),
  ('whoop_api', 'day_strain', true, 'cycle.score.strain'), ('whoop_api', 'avg_hr', true, 'cycle.score.average_heart_rate'),
  ('whoop_api', 'max_hr', true, 'cycle.score.max_heart_rate'), ('whoop_api', 'energy_kcal', true, 'cycle.score.kilojoule / 4.184'),
  ('whoop_api', 'steps', false, 'Not exposed by the WHOOP developer API'),
  ('whoop_api', 'sleep_total_min', true, 'sleep.score.stage_summary'), ('whoop_api', 'in_bed_min', true, 'sleep.score.stage_summary.total_in_bed_time_milli'),
  ('whoop_api', 'awake_min', true, 'sleep.score.stage_summary.total_awake_time_milli'), ('whoop_api', 'light_min', true, 'sleep.score.stage_summary.total_light_sleep_time_milli'),
  ('whoop_api', 'deep_min', true, 'sleep.score.stage_summary.total_slow_wave_sleep_time_milli'), ('whoop_api', 'rem_min', true, 'sleep.score.stage_summary.total_rem_sleep_time_milli'),
  ('whoop_api', 'sleep_cycles', true, 'sleep.score.stage_summary.sleep_cycle_count'), ('whoop_api', 'disturbances', true, 'sleep.score.stage_summary.disturbance_count'),
  ('whoop_api', 'sleep_efficiency', true, 'sleep.score.sleep_efficiency_percentage'), ('whoop_api', 'sleep_performance', true, 'sleep.score.sleep_performance_percentage'),
  ('whoop_api', 'sleep_consistency', true, 'sleep.score.sleep_consistency_percentage'), ('whoop_api', 'sleep_need_min', true, 'sleep.score.sleep_needed'),
  ('whoop_api', 'sleep_debt_min', true, 'sleep.score.sleep_needed.need_from_sleep_debt_milli'), ('whoop_api', 'sleep_onset_min', true, 'sleep.start'),
  ('whoop_api', 'wake_min', true, 'sleep.end'), ('whoop_api', 'nap_min', true, 'sleep.nap'), ('whoop_api', 'nap_count', true, 'sleep.nap'),
  ('whoop_api', 'workout_count', true, 'workout'), ('whoop_api', 'workout_min', true, 'workout.start/end'), ('whoop_api', 'workout_strain', true, 'workout.score.strain'),
  ('whoop_api', 'workout_avg_hr', true, 'workout.score.average_heart_rate'), ('whoop_api', 'workout_max_hr', true, 'workout.score.max_heart_rate'),
  ('whoop_api', 'workout_kcal', true, 'workout.score.kilojoule / 4.184'),
  ('ble', 'avg_hr', true, 'Live sessions only; not a daily measure'), ('ble', 'hrv_rmssd', true, 'Spot RMSSD during a live session; not the overnight value')
on conflict (provider, metric) do update set available = excluded.available, notes = excluded.notes;

-- Manually logged behaviours (not sensor data). Medication rows are private: never surfaced in insight text.
create table if not exists public.health_behaviors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  at timestamptz,
  kind text not null check (kind in ('caffeine', 'alcohol', 'water', 'meal', 'calories', 'protein', 'exercise', 'bedtime_routine', 'supplement', 'stress', 'travel', 'illness', 'medication')),
  amount numeric(10,2),
  unit text check (unit is null or length(unit) <= 16),
  note text check (note is null or length(note) <= 500),
  private boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists health_behaviors_user_day_idx on public.health_behaviors (user_id, day desc);
alter table public.health_behaviors enable row level security;
drop policy if exists "health_behaviors: owner all" on public.health_behaviors;
create policy "health_behaviors: owner all" on public.health_behaviors for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- WHOOP developer API connection: tokens encrypted at rest; only the status is readable from the browser.
create table if not exists public.whoop_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  whoop_user_id text,
  access_token_enc text not null,
  refresh_token_enc text not null,
  expires_at timestamptz not null,
  scopes text not null default '',
  status text not null default 'active' check (status in ('active', 'error', 'reauth_required', 'disconnected')),
  error_message text,
  last_synced_at timestamptz,
  last_webhook_at timestamptz,
  backfill_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.whoop_connections enable row level security;
drop policy if exists "whoop_connections: owner read status" on public.whoop_connections;
create policy "whoop_connections: owner read status" on public.whoop_connections for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "whoop_connections: owner delete" on public.whoop_connections;
create policy "whoop_connections: owner delete" on public.whoop_connections for delete to authenticated using ((select auth.uid()) = user_id);
-- Browser clients may read the connection's status but never the tokens.
revoke select on public.whoop_connections from authenticated;
grant select (user_id, whoop_user_id, expires_at, scopes, status, error_message, last_synced_at, last_webhook_at, backfill_done, created_at, updated_at) on public.whoop_connections to authenticated;
create or replace trigger whoop_connections_set_updated_at before update on public.whoop_connections for each row execute function public.set_updated_at();

-- Raw WHOOP API records, kept verbatim for auditability. One row per record; updates replace the raw body.
create table if not exists public.whoop_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('cycle', 'recovery', 'sleep', 'workout', 'body')),
  record_id text not null check (length(record_id) <= 120),
  raw jsonb not null,
  record_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, kind, record_id)
);
create index if not exists whoop_records_user_kind_idx on public.whoop_records (user_id, kind, record_updated_at desc);
alter table public.whoop_records enable row level security;
drop policy if exists "whoop_records: owner read" on public.whoop_records;
create policy "whoop_records: owner read" on public.whoop_records for select to authenticated using ((select auth.uid()) = user_id);

-- Processed webhook deliveries, so a redelivered event is a no-op.
create table if not exists public.whoop_webhook_events (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  type text not null,
  received_at timestamptz not null default now()
);
alter table public.whoop_webhook_events enable row level security;
