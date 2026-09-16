-- FRADY OS initial schema
-- Personal operating system: work areas, projects, tasks, waiting-on, events (manual + Monday.com),
-- social posts, event templates, notifications. Every table is owned by a user and protected by RLS.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'America/Indiana/Indianapolis',
  week_starts_on smallint not null default 1 check (week_starts_on in (0, 1)),
  reminder_days_before_due integer not null default 2 check (reminder_days_before_due between 0 and 30),
  reminder_days_before_social integer not null default 2 check (reminder_days_before_social between 0 and 30),
  reminder_days_before_event integer not null default 7 check (reminder_days_before_event between 0 and 60),
  email_reminders_enabled boolean not null default false,
  notifications_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner select" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: owner insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles: owner update" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Work areas
-- ---------------------------------------------------------------------------
create table public.work_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  color text not null default '#6366f1',
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create index work_areas_user_idx on public.work_areas (user_id, sort_order);
alter table public.work_areas enable row level security;
create policy "work_areas: owner all" on public.work_areas for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_area_id uuid references public.work_areas(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 200),
  description text,
  links jsonb not null default '[]'::jsonb,
  status text not null default 'planned' check (status in ('planned', 'active', 'on_hold', 'completed', 'archived')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  target_date date,
  next_action text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index projects_user_idx on public.projects (user_id, status);
create index projects_work_area_idx on public.projects (work_area_id);
alter table public.projects enable row level security;
create policy "projects: owner all" on public.projects for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger projects_set_updated_at before update on public.projects for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Events (manual or imported from Monday.com)
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_area_id uuid references public.work_areas(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 300),
  start_date date,
  end_date date,
  start_time time,
  location text,
  program text,
  owner text,
  status text,
  website_url text,
  notes text,           -- imported notes (Monday) or event notes (manual)
  local_notes text,     -- my own notes; never overwritten by sync
  source text not null default 'manual' check (source in ('manual', 'monday')),
  monday_board_id text,
  monday_item_id text,
  monday_item_url text,
  monday_group text,
  monday_state text,
  monday_synced_at timestamptz,
  sync_flag text not null default 'none' check (sync_flag in ('none', 'canceled', 'removed')),
  sync_flag_reason text,
  sync_flag_at timestamptz,
  review_dismissed_at timestamptz,
  previous_start_date date,
  previous_end_date date,
  dates_changed_at timestamptz,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_monday_ref check (
    (source = 'manual' and monday_item_id is null) or
    (source = 'monday' and monday_board_id is not null and monday_item_id is not null)
  )
);
-- Stable identity for imported items: one local event per (user, board, item).
create unique index events_monday_unique on public.events (user_id, monday_board_id, monday_item_id)
  where monday_item_id is not null;
create index events_user_start_idx on public.events (user_id, start_date);
alter table public.events enable row level security;
create policy "events: owner all" on public.events for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger events_set_updated_at before update on public.events for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Event templates (reusable preparation + social milestones)
-- ---------------------------------------------------------------------------
create table public.event_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index event_templates_user_idx on public.event_templates (user_id);
alter table public.event_templates enable row level security;
create policy "event_templates: owner all" on public.event_templates for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger event_templates_set_updated_at before update on public.event_templates for each row execute function public.set_updated_at();

create table public.event_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.event_templates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('task', 'social')),
  title text not null check (length(trim(title)) between 1 and 200),
  description text,
  offset_days integer not null default 0,          -- relative to the event start date (negative = before)
  platform text,
  brand text,
  draft_lead_days integer,                         -- social: draft due this many days before publish
  approval_lead_days integer,                      -- social: approval due this many days before publish
  sort_order integer not null default 0
);
create index event_template_items_template_idx on public.event_template_items (template_id, sort_order);
alter table public.event_template_items enable row level security;
create policy "event_template_items: owner all" on public.event_template_items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Tasks (including "Waiting on Someone" fields and recurrence)
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_area_id uuid references public.work_areas(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 300),
  description text,
  status text not null default 'todo' check (status in ('inbox', 'todo', 'in_progress', 'waiting', 'completed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  planned_date date,
  due_date date,
  due_time time,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes >= 0),
  links jsonb not null default '[]'::jsonb,
  notes text,
  recurrence jsonb,
  recurrence_parent_id uuid references public.tasks(id) on delete set null,
  focus_rank smallint check (focus_rank between 1 and 3),
  sort_order double precision not null default 0,
  -- Waiting on someone
  waiting_person text,
  waiting_need text,
  waiting_requested_date date,
  waiting_expected_date date,
  waiting_followup_date date,
  waiting_last_followup_date date,
  waiting_notes text,
  waiting_received_at timestamptz,
  -- Template linkage (event preparation)
  template_item_id uuid references public.event_template_items(id) on delete set null,
  anchor_date date,
  offset_days integer,
  date_overridden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint tasks_completed_consistency check ((status = 'completed') = (completed_at is not null))
);
create index tasks_user_status_idx on public.tasks (user_id, status);
create index tasks_user_due_idx on public.tasks (user_id, due_date);
create index tasks_user_planned_idx on public.tasks (user_id, planned_date);
create index tasks_user_completed_idx on public.tasks (user_id, completed_at desc);
create index tasks_project_idx on public.tasks (project_id);
create index tasks_event_idx on public.tasks (event_id);
create index tasks_followup_idx on public.tasks (user_id, waiting_followup_date) where status = 'waiting';
create unique index tasks_focus_unique on public.tasks (user_id, focus_rank) where focus_rank is not null;
-- A recurring parent spawns at most one child per due date.
create unique index tasks_recurrence_child_unique on public.tasks (recurrence_parent_id, due_date) where recurrence_parent_id is not null;
alter table public.tasks enable row level security;
create policy "tasks: owner all" on public.tasks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 300),
  is_done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index subtasks_task_idx on public.subtasks (task_id, sort_order);
alter table public.subtasks enable row level security;
create policy "subtasks: owner all" on public.subtasks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- History of status changes (completion, reopening, rescheduling, follow-ups)
create table public.task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  from_status text,
  to_status text,
  detail text,
  created_at timestamptz not null default now()
);
create index task_activity_task_idx on public.task_activity (task_id, created_at desc);
alter table public.task_activity enable row level security;
create policy "task_activity: owner all" on public.task_activity for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Social posts: one record used by dashboard, event page, task views and calendar
-- ---------------------------------------------------------------------------
create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_area_id uuid references public.work_areas(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 300),
  brand text,
  platform text,
  draft_due_date date,
  approval_due_date date,
  publish_date date,
  publish_time time,
  status text not null default 'idea' check (status in ('idea', 'drafting', 'awaiting_approval', 'ready', 'scheduled', 'published')),
  approver text,
  followup_date date,
  caption text,
  assets jsonb not null default '[]'::jsonb,
  published_url text,
  notes text,
  template_item_id uuid references public.event_template_items(id) on delete set null,
  anchor_date date,
  offset_days integer,
  date_overridden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint social_published_consistency check ((status = 'published') = (published_at is not null))
);
create index social_posts_user_publish_idx on public.social_posts (user_id, publish_date);
create index social_posts_user_status_idx on public.social_posts (user_id, status);
create index social_posts_event_idx on public.social_posts (event_id);
create index social_posts_project_idx on public.social_posts (project_id);
alter table public.social_posts enable row level security;
create policy "social_posts: owner all" on public.social_posts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger social_posts_set_updated_at before update on public.social_posts for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Notes and attachments (attach to a task, project, event or social post)
-- ---------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  social_post_id uuid references public.social_posts(id) on delete cascade,
  body text not null check (length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_one_parent check (
    (task_id is not null)::int + (project_id is not null)::int + (event_id is not null)::int + (social_post_id is not null)::int = 1
  )
);
create index notes_task_idx on public.notes (task_id);
create index notes_project_idx on public.notes (project_id);
create index notes_event_idx on public.notes (event_id);
create index notes_social_idx on public.notes (social_post_id);
alter table public.notes enable row level security;
create policy "notes: owner all" on public.notes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger notes_set_updated_at before update on public.notes for each row execute function public.set_updated_at();

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  social_post_id uuid references public.social_posts(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint attachments_one_parent check (
    (task_id is not null)::int + (project_id is not null)::int + (event_id is not null)::int + (social_post_id is not null)::int = 1
  )
);
create index attachments_task_idx on public.attachments (task_id);
create index attachments_project_idx on public.attachments (project_id);
create index attachments_event_idx on public.attachments (event_id);
create index attachments_social_idx on public.attachments (social_post_id);
alter table public.attachments enable row level security;
create policy "attachments: owner all" on public.attachments for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Monday.com connection (per user) and sync runs
-- ---------------------------------------------------------------------------
create table public.monday_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  board_id text not null,
  board_name text,
  column_map jsonb not null default '{}'::jsonb,
  columns_snapshot jsonb not null default '[]'::jsonb,
  canceled_labels text[] not null default array['canceled', 'cancelled']::text[],
  auto_sync_enabled boolean not null default true,
  last_sync_started_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.monday_connections enable row level security;
create policy "monday_connections: owner all" on public.monday_connections for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger monday_connections_set_updated_at before update on public.monday_connections for each row execute function public.set_updated_at();

create table public.monday_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'scheduled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  result jsonb,
  error text
);
create index monday_sync_runs_user_idx on public.monday_sync_runs (user_id, started_at desc);
alter table public.monday_sync_runs enable row level security;
create policy "monday_sync_runs: owner select" on public.monday_sync_runs for select to authenticated using ((select auth.uid()) = user_id);
create policy "monday_sync_runs: owner insert" on public.monday_sync_runs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "monday_sync_runs: owner update" on public.monday_sync_runs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Notifications (deduplicated by key)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  href text,
  entity_type text,
  entity_id uuid,
  dedupe_key text not null,
  due_date date,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
alter table public.notifications enable row level security;
create policy "notifications: owner all" on public.notifications for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Storage bucket for attachments (private; path must start with the user's id)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments bucket: owner select" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "attachments bucket: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "attachments bucket: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "attachments bucket: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile, default work areas, starter event template.
-- No projects, tasks or deadlines are invented.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_user(p_user_id uuid, p_display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
begin
  insert into public.profiles (id, display_name)
  values (p_user_id, p_display_name)
  on conflict (id) do nothing;

  insert into public.work_areas (user_id, name, color, sort_order)
  values
    (p_user_id, 'ARI', '#2563eb', 0),
    (p_user_id, 'Northwestern Mutual', '#0f766e', 1),
    (p_user_id, 'Personal', '#7c3aed', 2)
  on conflict (user_id, name) do nothing;

  if not exists (select 1 from public.event_templates where user_id = p_user_id) then
    insert into public.event_templates (user_id, name, description, is_default)
    values (p_user_id, 'Standard event promotion', 'Announcement, promotion, reminders, day-of post and recap. Edit offsets to fit the event.', true)
    returning id into v_template_id;

    insert into public.event_template_items (template_id, user_id, kind, title, offset_days, platform, draft_lead_days, approval_lead_days, sort_order)
    values
      (v_template_id, p_user_id, 'social', 'One-month-out announcement', -30, null, 5, 2, 0),
      (v_template_id, p_user_id, 'social', 'Two-weeks-out promotion', -14, null, 5, 2, 1),
      (v_template_id, p_user_id, 'social', 'One-week-out reminder', -7, null, 3, 1, 2),
      (v_template_id, p_user_id, 'social', 'Final registration reminder', -2, null, 2, 1, 3),
      (v_template_id, p_user_id, 'social', 'Day-of post', 0, null, 1, 0, 4),
      (v_template_id, p_user_id, 'social', 'Post-event recap', 1, null, 0, 0, 5);
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bootstrap_user(new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Allow a signed-in user to (re)bootstrap their own workspace (used as a safety net on first load).
create or replace function public.ensure_workspace()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  perform public.bootstrap_user(auth.uid(), null);
end;
$$;
revoke all on function public.ensure_workspace() from public;
grant execute on function public.ensure_workspace() to authenticated;
revoke all on function public.bootstrap_user(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Global search across projects, tasks, events and social posts
-- ---------------------------------------------------------------------------
create or replace function public.search_workspace(q text, max_results integer default 30)
returns table (
  kind text,
  id uuid,
  title text,
  subtitle text,
  date_hint date,
  status text
)
language sql
stable
security invoker
set search_path = public
as $$
  with needle as (select '%' || regexp_replace(trim(q), '\s+', '%', 'g') || '%' as pat)
  (
    select 'project'::text, p.id, p.name, coalesce(p.next_action, p.description), p.target_date, p.status
    from public.projects p, needle
    where p.user_id = auth.uid() and (p.name ilike needle.pat or coalesce(p.description, '') ilike needle.pat or coalesce(p.next_action, '') ilike needle.pat)
    limit max_results
  )
  union all
  (
    select 'task'::text, t.id, t.title, coalesce(t.waiting_person, t.description), coalesce(t.due_date, t.planned_date), t.status
    from public.tasks t, needle
    where t.user_id = auth.uid() and (t.title ilike needle.pat or coalesce(t.description, '') ilike needle.pat or coalesce(t.waiting_person, '') ilike needle.pat)
    limit max_results
  )
  union all
  (
    select 'event'::text, e.id, e.name, coalesce(e.location, e.program), e.start_date, e.status
    from public.events e, needle
    where e.user_id = auth.uid() and (e.name ilike needle.pat or coalesce(e.location, '') ilike needle.pat or coalesce(e.program, '') ilike needle.pat)
    limit max_results
  )
  union all
  (
    select 'social'::text, s.id, s.title, coalesce(s.platform, '') || case when s.brand is not null then ' · ' || s.brand else '' end, s.publish_date, s.status
    from public.social_posts s, needle
    where s.user_id = auth.uid() and (s.title ilike needle.pat or coalesce(s.caption, '') ilike needle.pat or coalesce(s.brand, '') ilike needle.pat)
    limit max_results
  )
  limit max_results;
$$;
revoke all on function public.search_workspace(text, integer) from public;
grant execute on function public.search_workspace(text, integer) to authenticated;
