-- Second Monday.com connection per user: the social media board.
-- FRADY OS creates items there for each event's social milestones and reads them back.

alter table public.monday_connections drop constraint if exists monday_connections_user_id_key;
alter table public.monday_connections add column if not exists purpose text not null default 'events';
alter table public.monday_connections drop constraint if exists monday_connections_purpose_check;
alter table public.monday_connections add constraint monday_connections_purpose_check check (purpose in ('events', 'social'));
create unique index if not exists monday_connections_user_purpose_idx on public.monday_connections (user_id, purpose);
alter table public.monday_connections add column if not exists group_id text;            -- target group for new items
alter table public.monday_connections add column if not exists status_map jsonb not null default '{}'::jsonb; -- FRADY status -> Monday label
alter table public.monday_connections add column if not exists board_url text;

alter table public.monday_sync_runs add column if not exists connection_id uuid references public.monday_connections(id) on delete set null;
alter table public.monday_sync_runs add column if not exists purpose text not null default 'events';
create index if not exists monday_sync_runs_connection_idx on public.monday_sync_runs (connection_id, started_at desc);

alter table public.social_posts add column if not exists monday_board_id text;
alter table public.social_posts add column if not exists monday_item_id text;
alter table public.social_posts add column if not exists monday_item_url text;
alter table public.social_posts add column if not exists monday_synced_at timestamptz;
alter table public.social_posts add column if not exists monday_pushed_at timestamptz;
alter table public.social_posts add column if not exists monday_push_error text;
alter table public.social_posts add column if not exists monday_removed_at timestamptz;
alter table public.social_posts add column if not exists monday_raw jsonb;
create unique index if not exists social_posts_monday_unique on public.social_posts (user_id, monday_board_id, monday_item_id) where monday_item_id is not null;
