-- Monday.com items the user deleted locally. The sync skips them so they are not re-imported;
-- restoring (deleting the row) brings the item back on the next sync.
create table public.monday_excluded_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  board_id text not null,
  item_id text not null,
  title text,
  excluded_at timestamptz not null default now(),
  unique (user_id, board_id, item_id)
);
create index monday_excluded_items_user_idx on public.monday_excluded_items (user_id, board_id);
alter table public.monday_excluded_items enable row level security;
create policy "monday_excluded_items: owner all" on public.monday_excluded_items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
