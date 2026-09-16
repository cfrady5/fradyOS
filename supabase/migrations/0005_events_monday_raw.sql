-- Raw snapshot of the mapped Monday.com column values for each imported event (debugging + remapping).
alter table public.events add column if not exists monday_raw jsonb;
