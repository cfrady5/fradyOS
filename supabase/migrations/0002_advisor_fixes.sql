-- Follow-ups from the Supabase security and performance advisors.

-- Pin the search_path of the trigger helper (advisor: function_search_path_mutable).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- SECURITY DEFINER functions must not be callable through the REST API by anon/authenticated,
-- except ensure_workspace, which signed-in users call on purpose (it only touches auth.uid()).
revoke execute on function public.bootstrap_user(uuid, text) from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.ensure_workspace() from anon;
revoke execute on function public.search_workspace(text, integer) from anon;

-- Covering indexes for foreign keys used by RLS filters and joins (advisor: unindexed_foreign_keys).
create index if not exists attachments_user_idx on public.attachments (user_id);
create index if not exists event_template_items_user_idx on public.event_template_items (user_id);
create index if not exists events_project_idx on public.events (project_id);
create index if not exists events_work_area_idx on public.events (work_area_id);
create index if not exists notes_user_idx on public.notes (user_id);
create index if not exists social_posts_template_item_idx on public.social_posts (template_item_id);
create index if not exists social_posts_work_area_idx on public.social_posts (work_area_id);
create index if not exists subtasks_user_idx on public.subtasks (user_id);
create index if not exists task_activity_user_idx on public.task_activity (user_id);
create index if not exists tasks_template_item_idx on public.tasks (template_item_id);
create index if not exists tasks_work_area_idx on public.tasks (work_area_id);
