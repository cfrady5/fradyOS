/** Client-safe calendar item types and display metadata (no server imports). */

export type CalendarItemKind = "event" | "due" | "planned" | "followup" | "delivery" | "social_publish" | "social_draft" | "social_approval";

export type CalendarItem = {
  id: string; // unique per row (kind + entity id)
  entityId: string;
  entityType: "task" | "event" | "social";
  kind: CalendarItemKind;
  date: string;
  endDate?: string | null;
  time?: string | null;
  title: string;
  subtitle?: string | null;
  done?: boolean;
  readOnly?: boolean; // Monday-synced event dates
  color?: string | null;
};

export const KIND_META: Record<CalendarItemKind, { label: string; className: string; short: string }> = {
  event: { label: "Events", className: "bg-primary/15 text-primary border-primary/30", short: "Event" },
  due: { label: "Task deadlines", className: "bg-destructive/10 text-destructive border-destructive/30", short: "Due" },
  planned: { label: "Planned work", className: "bg-muted text-foreground border-dashed", short: "Plan" },
  followup: { label: "Follow-ups", className: "bg-warning/25 text-amber-900 dark:text-amber-100 border-warning/50", short: "Follow-up" },
  delivery: { label: "Expected deliveries", className: "bg-warning/10 text-amber-900 dark:text-amber-100 border-warning/40", short: "Delivery" },
  social_publish: { label: "Social publish", className: "bg-fuchsia-500/15 text-fuchsia-800 dark:text-fuchsia-200 border-fuchsia-500/30", short: "Publish" },
  social_draft: { label: "Social drafts due", className: "bg-fuchsia-500/8 text-fuchsia-800 dark:text-fuchsia-200 border-fuchsia-500/20", short: "Draft" },
  social_approval: { label: "Social approvals due", className: "bg-fuchsia-500/8 text-fuchsia-800 dark:text-fuchsia-200 border-fuchsia-500/20", short: "Approval" },
};
