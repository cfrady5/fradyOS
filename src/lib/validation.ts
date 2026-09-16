import { z } from "zod";

export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }, "Not a real date");

export const optionalDate = z.preprocess((v) => (v === "" || v === undefined ? null : v), dateOnly.nullable());

export const timeOnly = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM");
export const optionalTime = z.preprocess((v) => (v === "" || v === undefined ? null : v), timeOnly.nullable());

export const optionalUuid = z.preprocess(
  (v) => (v === "" || v === undefined || v === "none" ? null : v),
  z.string().uuid().nullable(),
);

export const optionalText = (max = 5000) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max).nullable().optional())
    .transform((v) => (v ? v : null));

export const optionalInt = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? parseInt(v, 10) : v),
  z.number().int().min(0).max(100000).nullable(),
);

export const linkSchema = z.object({
  label: z.string().trim().max(120).default(""),
  url: z.string().trim().url("Enter a valid URL (include https://)"),
});

// No .default() here: defaults are applied by create actions so partial updates never reset fields.
export const linksSchema = z.array(linkSchema).max(50);

export const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const taskStatusSchema = z.enum(["inbox", "todo", "in_progress", "waiting", "completed"]);
export const projectStatusSchema = z.enum(["planned", "active", "on_hold", "completed", "archived"]);
export const socialStatusSchema = z.enum(["idea", "drafting", "awaiting_approval", "ready", "scheduled", "published"]);
export const platformSchema = z.enum(["linkedin", "instagram", "facebook", "x", "tiktok", "youtube", "email", "website", "other"]);

export const recurrenceSchema = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    basis: z.enum(["due", "completion"]).default("due"),
    until: optionalDate.optional(),
  })
  .nullable();

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(300),
  description: optionalText(20000),
  work_area_id: optionalUuid,
  project_id: optionalUuid,
  event_id: optionalUuid,
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  planned_date: optionalDate,
  due_date: optionalDate,
  due_time: optionalTime,
  estimated_minutes: optionalInt,
  links: linksSchema.optional(),
  notes: optionalText(20000),
  recurrence: recurrenceSchema.optional(),
  waiting_person: optionalText(200),
  waiting_need: optionalText(2000),
  waiting_requested_date: optionalDate,
  waiting_expected_date: optionalDate,
  waiting_followup_date: optionalDate,
  waiting_notes: optionalText(5000),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

export const projectInputSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name").max(200),
  description: optionalText(20000),
  work_area_id: optionalUuid,
  links: linksSchema.optional(),
  status: projectStatusSchema.optional(),
  priority: prioritySchema.optional(),
  target_date: optionalDate,
  next_action: optionalText(500),
  notes: optionalText(20000),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;

export const eventInputSchema = z.object({
  name: z.string().trim().min(1, "Give the event a name").max(300),
  work_area_id: optionalUuid,
  project_id: optionalUuid,
  start_date: optionalDate,
  end_date: optionalDate,
  start_time: optionalTime,
  location: optionalText(500),
  program: optionalText(200),
  owner: optionalText(200),
  status: optionalText(100),
  website_url: z.preprocess((v) => (v === "" ? null : v), z.string().url("Enter a valid URL").nullable()),
  notes: optionalText(20000),
  local_notes: optionalText(20000),
});

export type EventInput = z.infer<typeof eventInputSchema>;

export const socialPostInputSchema = z.object({
  title: z.string().trim().min(1, "Give the post a title").max(300),
  work_area_id: optionalUuid,
  project_id: optionalUuid,
  event_id: optionalUuid,
  brand: optionalText(120),
  platform: z.preprocess((v) => (v === "" ? null : v), platformSchema.nullable()),
  draft_due_date: optionalDate,
  approval_due_date: optionalDate,
  publish_date: optionalDate,
  publish_time: optionalTime,
  status: socialStatusSchema.optional(),
  approver: optionalText(200),
  followup_date: optionalDate,
  caption: optionalText(20000),
  assets: linksSchema.optional(),
  published_url: z.preprocess((v) => (v === "" ? null : v), z.string().url("Enter a valid URL").nullable()),
  notes: optionalText(20000),
});

export type SocialPostInput = z.infer<typeof socialPostInputSchema>;

export function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function firstZodMessage(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}` : "Invalid input";
}
