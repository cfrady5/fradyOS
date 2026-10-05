/** Client-safe calendar item types and display metadata (no server imports). */

export type CalendarItemKind = "event" | "due" | "planned" | "followup" | "delivery" | "social_publish" | "social_draft" | "social_approval" | "finance";

export type CalendarItem = {
  id: string; // unique per row (kind + entity id)
  entityId: string;
  entityType: "task" | "event" | "social" | "finance";
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
  event: { label: "Events", className: "bg-primary/15 text-primary-soft border-primary/30", short: "Event" },
  due: { label: "Task deadlines", className: "bg-destructive/12 text-destructive border-destructive/30", short: "Due" },
  planned: { label: "Planned work", className: "bg-secondary text-foreground border-border border-dashed", short: "Plan" },
  followup: { label: "Follow-ups", className: "bg-warning/15 text-warning border-warning/40", short: "Follow-up" },
  delivery: { label: "Expected deliveries", className: "bg-warning/10 text-warning border-warning/30", short: "Delivery" },
  social_publish: { label: "Social publish", className: "bg-chart-5/15 text-chart-5 border-chart-5/30", short: "Publish" },
  social_draft: { label: "Social drafts due", className: "bg-chart-5/10 text-chart-5 border-chart-5/25", short: "Draft" },
  social_approval: { label: "Social approvals due", className: "bg-chart-5/10 text-chart-5 border-chart-5/25", short: "Approval" },
  finance: { label: "Financial milestones", className: "bg-success/12 text-success border-success/30", short: "Finance" },
};
