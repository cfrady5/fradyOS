-- Health Intelligence: the unified biometric model, baselines, detections, derived scores,
-- correlations, insights, rules, preferences, processing jobs, source capabilities and behaviour logs. Every user-scoped table is owner-only under RLS.
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
  provider text not null check (provider in ('ble', 'noop_export', 'whoop_export', 'manual')),
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
  provider text check (provider is null or provider in ('ble', 'noop_export', 'whoop_export', 'manual')),
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
  kind text not null check (kind in ('recompute', 'import', 'strap', 'scheduled')),
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
  ('ble', 'resting_hr', true, 'Lowest 5-minute mean during the main sleep, from strap samples'), ('ble', 'hrv_rmssd', true, 'Median 5-minute RMSSD over the last three hours of sleep'),
  ('ble', 'resp_rate', true, 'Estimated from respiratory sinus arrhythmia in the R-R series'), ('ble', 'spo2', false, 'Raw red/IR channel is uncalibrated'),
  ('ble', 'skin_temp', false, 'Raw ADC channel is uncalibrated'), ('ble', 'recovery_score', false, 'No strap-side score; FRADY Readiness is the equivalent'),
  ('ble', 'day_strain', true, 'FRADY strain: Banister TRIMP mapped to 0..21'), ('ble', 'avg_hr', true, null), ('ble', 'max_hr', true, null), ('ble', 'energy_kcal', false, 'Not estimated'),
  ('ble', 'steps', false, 'Not derived from the strap accelerometer'), ('ble', 'sleep_total_min', true, 'Actigraphy plus heart-rate sleep detection'), ('ble', 'in_bed_min', true, null), ('ble', 'awake_min', true, null),
  ('ble', 'light_min', true, 'Heuristic stage estimate, not EEG'), ('ble', 'deep_min', true, 'Heuristic stage estimate, not EEG'), ('ble', 'rem_min', true, 'Heuristic stage estimate, not EEG'),
  ('ble', 'sleep_cycles', false, null), ('ble', 'disturbances', true, 'Awake bouts of two minutes or more'), ('ble', 'sleep_efficiency', true, null), ('ble', 'sleep_performance', false, null),
  ('ble', 'sleep_consistency', true, 'From bedtime deviation against the 7-day median'), ('ble', 'sleep_need_min', false, null), ('ble', 'sleep_debt_min', false, null), ('ble', 'sleep_onset_min', true, null), ('ble', 'wake_min', true, null),
  ('ble', 'nap_min', true, null), ('ble', 'nap_count', true, null), ('ble', 'workout_count', true, 'Runs of ten minutes or more above 60% heart-rate reserve'), ('ble', 'workout_min', true, null), ('ble', 'workout_strain', true, null),
  ('ble', 'workout_avg_hr', true, null), ('ble', 'workout_max_hr', true, null), ('ble', 'workout_kcal', false, null)
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
