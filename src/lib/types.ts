/** Domain types mirroring supabase/migrations/0001_init.sql. Date-only columns are "YYYY-MM-DD" strings. */

export type TaskStatus = "inbox" | "todo" | "in_progress" | "waiting" | "completed";
export type Priority = "low" | "normal" | "high" | "urgent";
export type ProjectStatus = "planned" | "active" | "on_hold" | "completed" | "archived";
export type SocialStatus = "idea" | "drafting" | "awaiting_approval" | "ready" | "scheduled" | "published";
export type EventSource = "manual" | "monday";
export type SyncFlag = "none" | "canceled" | "removed";
export type TemplateItemKind = "task" | "social";
export type Platform = "linkedin" | "instagram" | "facebook" | "x" | "tiktok" | "youtube" | "email" | "website" | "other";

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting", label: "Waiting on Someone" },
  { value: "completed", label: "Completed" },
];

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

export const SOCIAL_STATUSES: { value: SocialStatus; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "drafting", label: "Drafting" },
  { value: "awaiting_approval", label: "Awaiting Approval" },
  { value: "ready", label: "Ready" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
];

export const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "x", label: "X" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

export function labelFor<T extends string>(list: { value: T; label: string }[], value: T | null | undefined): string {
  return list.find((x) => x.value === value)?.label ?? (value ?? "");
}

export interface Link {
  label: string;
  url: string;
}

export interface RecurrenceRule {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number; // every N units
  byWeekday?: number[]; // 0-6, for weekly
  basis: "due" | "completion"; // next date computed from the due date or from the completion date
  until?: string | null; // YYYY-MM-DD
}

export interface Profile {
  id: string;
  display_name: string | null;
  timezone: string;
  week_starts_on: 0 | 1;
  reminder_days_before_due: number;
  reminder_days_before_social: number;
  reminder_days_before_event: number;
  email_reminders_enabled: boolean;
  notifications_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkArea {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sort_order: number;
  is_archived: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  work_area_id: string | null;
  name: string;
  description: string | null;
  links: Link[];
  status: ProjectStatus;
  priority: Priority;
  target_date: string | null;
  next_action: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Task {
  id: string;
  user_id: string;
  work_area_id: string | null;
  project_id: string | null;
  event_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  planned_date: string | null;
  due_date: string | null;
  due_time: string | null;
  estimated_minutes: number | null;
  links: Link[];
  notes: string | null;
  recurrence: RecurrenceRule | null;
  recurrence_parent_id: string | null;
  focus_rank: number | null;
  sort_order: number;
  waiting_person: string | null;
  waiting_need: string | null;
  waiting_requested_date: string | null;
  waiting_expected_date: string | null;
  waiting_followup_date: string | null;
  waiting_last_followup_date: string | null;
  waiting_notes: string | null;
  waiting_received_at: string | null;
  template_item_id: string | null;
  anchor_date: string | null;
  offset_days: number | null;
  date_overridden: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Subtask {
  id: string;
  task_id: string;
  user_id: string;
  title: string;
  is_done: boolean;
  sort_order: number;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  task_id: string | null;
  project_id: string | null;
  event_id: string | null;
  social_post_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  user_id: string;
  task_id: string | null;
  project_id: string | null;
  event_id: string | null;
  social_post_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

export interface TaskActivity {
  id: string;
  task_id: string;
  user_id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  detail: string | null;
  created_at: string;
}

export interface Event {
  id: string;
  user_id: string;
  work_area_id: string | null;
  project_id: string | null;
  name: string;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  location: string | null;
  program: string | null;
  owner: string | null;
  status: string | null;
  website_url: string | null;
  notes: string | null;
  local_notes: string | null;
  source: EventSource;
  monday_board_id: string | null;
  monday_item_id: string | null;
  monday_item_url: string | null;
  monday_group: string | null;
  monday_state: string | null;
  monday_synced_at: string | null;
  sync_flag: SyncFlag;
  sync_flag_reason: string | null;
  sync_flag_at: string | null;
  review_dismissed_at: string | null;
  previous_start_date: string | null;
  previous_end_date: string | null;
  dates_changed_at: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface SocialPost {
  id: string;
  user_id: string;
  work_area_id: string | null;
  project_id: string | null;
  event_id: string | null;
  title: string;
  brand: string | null;
  platform: Platform | null;
  draft_due_date: string | null;
  approval_due_date: string | null;
  publish_date: string | null;
  publish_time: string | null;
  status: SocialStatus;
  approver: string | null;
  followup_date: string | null;
  caption: string | null;
  assets: Link[];
  published_url: string | null;
  notes: string | null;
  template_item_id: string | null;
  anchor_date: string | null;
  offset_days: number | null;
  date_overridden: boolean;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface EventTemplate {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventTemplateItem {
  id: string;
  template_id: string;
  user_id: string;
  kind: TemplateItemKind;
  title: string;
  description: string | null;
  offset_days: number;
  platform: Platform | null;
  brand: string | null;
  draft_lead_days: number | null;
  approval_lead_days: number | null;
  sort_order: number;
}

export interface MondayColumnMap {
  name?: string | null; // column id, or "__name__" for the item name
  start?: string | null; // date or timeline column id
  end?: string | null; // date column id (ignored when start is a timeline)
  location?: string | null;
  program?: string | null;
  owner?: string | null;
  status?: string | null;
  website?: string | null;
  notes?: string | null;
}

export interface MondayConnection {
  id: string;
  user_id: string;
  board_id: string;
  board_name: string | null;
  column_map: MondayColumnMap;
  columns_snapshot: { id: string; title: string; type: string }[];
  canceled_labels: string[];
  auto_sync_enabled: boolean;
  webhook_ids: string[];
  last_webhook_at: string | null;
  last_sync_started_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_result: SyncResult | null;
  created_at: string;
  updated_at: string;
}

export interface SyncResult {
  items_seen: number;
  created: number;
  updated: number;
  unchanged: number;
  dates_changed: number;
  flagged_canceled: number;
  flagged_removed: number;
  duration_ms: number;
}

export interface MondaySyncRun {
  id: string;
  user_id: string;
  trigger: "manual" | "scheduled" | "webhook";
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error";
  result: SyncResult | null;
  error: string | null;
}

export interface Notification {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  entity_type: string | null;
  entity_id: string | null;
  dedupe_key: string;
  due_date: string | null;
  read_at: string | null;
  emailed_at: string | null;
  created_at: string;
}

/** Expanded task with joined display fields used across views. */
export interface TaskWithRefs extends Task {
  project?: Pick<Project, "id" | "name"> | null;
  work_area?: Pick<WorkArea, "id" | "name" | "color"> | null;
  event?: Pick<Event, "id" | "name" | "start_date"> | null;
  subtask_total?: number;
  subtask_done?: number;
}

export interface SocialPostWithRefs extends SocialPost {
  project?: Pick<Project, "id" | "name"> | null;
  work_area?: Pick<WorkArea, "id" | "name" | "color"> | null;
  event?: Pick<Event, "id" | "name" | "start_date"> | null;
}

export interface ProjectWithStats extends Project {
  work_area?: Pick<WorkArea, "id" | "name" | "color"> | null;
  task_total: number;
  task_done: number;
  overdue_count: number;
  waiting_count: number;
}
