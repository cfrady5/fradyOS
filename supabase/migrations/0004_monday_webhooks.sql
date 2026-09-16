-- Monday.com webhooks: allow webhook-triggered sync runs and remember registered webhook ids.
alter table public.monday_sync_runs drop constraint if exists monday_sync_runs_trigger_check;
alter table public.monday_sync_runs add constraint monday_sync_runs_trigger_check check (trigger in ('manual', 'scheduled', 'webhook'));
alter table public.monday_connections add column if not exists webhook_ids jsonb not null default '[]'::jsonb;
alter table public.monday_connections add column if not exists last_webhook_at timestamptz;
