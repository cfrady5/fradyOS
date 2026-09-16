import type { SocialColumnMap, SocialPost, SocialStatus } from "@/lib/types";
import { PLATFORMS, SOCIAL_STATUSES } from "@/lib/types";
import type { MondayColumnValue, MondayItem } from "./client";
import { NAME_COLUMN, readDateColumn } from "./mapping";

export const SOCIAL_FIELD_ORDER: (keyof SocialColumnMap)[] = ["name", "publish_date", "draft_due", "approval_due", "status", "platform", "brand", "caption", "event_link", "published_url", "approver", "notes"];

export const SOCIAL_FIELD_LABELS: Record<keyof SocialColumnMap, { label: string; hint: string }> = {
  name: { label: "Post title", hint: "Defaults to the item name." },
  publish_date: { label: "Publish date", hint: "Date column. Time is written when set." },
  draft_due: { label: "Draft deadline", hint: "Date column." },
  approval_due: { label: "Approval deadline", hint: "Date column." },
  status: { label: "Status", hint: "Status column. Map its labels to FRADY OS statuses below." },
  platform: { label: "Platform", hint: "Status or dropdown column (LinkedIn, Instagram…)." },
  brand: { label: "Brand / account", hint: "Status, dropdown or text column." },
  caption: { label: "Caption", hint: "Long text column." },
  event_link: { label: "Related event", hint: "Connect-boards column pointing at the events board, or a text column." },
  published_url: { label: "Published post URL", hint: "Link column." },
  approver: { label: "Approver", hint: "People or text column (read-only)." },
  notes: { label: "Notes", hint: "Long text or text column." },
};

export const SOCIAL_FIELD_COLUMN_TYPES: Record<keyof SocialColumnMap, string[]> = {
  name: ["name", "text"],
  publish_date: ["date", "timeline"],
  draft_due: ["date"],
  approval_due: ["date"],
  status: ["status"],
  platform: ["status", "dropdown", "text"],
  brand: ["status", "dropdown", "text"],
  caption: ["long_text", "text"],
  event_link: ["board_relation", "text"],
  published_url: ["link", "text"],
  approver: ["people", "person", "text"],
  notes: ["long_text", "text"],
};

/** Labels available on a status or dropdown column, read from its settings_str. */
export function parseColumnLabels(column: { type: string; settings_str?: string | null }): string[] {
  if (!column.settings_str) return [];
  try {
    const s = JSON.parse(column.settings_str) as Record<string, unknown>;
    if (column.type === "status" && s.labels && typeof s.labels === "object") {
      return Object.values(s.labels as Record<string, string>).filter((l) => typeof l === "string" && l.trim());
    }
    if (column.type === "dropdown") {
      const settings = (s.settings ?? s) as { labels?: { name: string }[] };
      return (settings.labels ?? []).map((l) => l.name).filter(Boolean);
    }
  } catch {
    // ignore malformed settings
  }
  return [];
}

const STATUS_HINTS: [SocialStatus, RegExp][] = [
  ["published", /publish|posted|live|done|complete/i],
  ["scheduled", /schedul/i],
  ["ready", /ready|approved|final/i],
  ["awaiting_approval", /approv|review|pending/i],
  ["drafting", /draft|working|in progress|writing/i],
  ["idea", /idea|backlog|todo|to do|planned|not started/i],
];

/** Monday label → FRADY OS status: explicit map first, then keyword heuristics. */
export function labelToStatus(label: string | null | undefined, statusMap: Record<string, string>): SocialStatus | null {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  for (const [status, mapped] of Object.entries(statusMap)) {
    if (mapped && mapped.trim().toLowerCase() === l && SOCIAL_STATUSES.some((s) => s.value === status)) return status as SocialStatus;
  }
  for (const [status, re] of STATUS_HINTS) if (re.test(l)) return status;
  return null;
}

/** FRADY OS status → Monday label. Only explicit mappings are written, so the board never gains surprise labels. */
export function statusToLabel(status: SocialStatus, statusMap: Record<string, string>): string | null {
  const v = statusMap[status];
  return v && v.trim() ? v.trim() : null;
}

export function platformFromText(text: string | null | undefined): SocialPost["platform"] {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const hit = PLATFORMS.find((p) => t === p.label.toLowerCase() || t === p.value || t.includes(p.label.toLowerCase()));
  if (hit) return hit.value;
  if (/twitter|x\.com|\bx\b/.test(t)) return "x";
  return "other";
}

export function platformToLabel(platform: SocialPost["platform"], available: string[]): string | null {
  if (!platform) return null;
  const label = PLATFORMS.find((p) => p.value === platform)?.label ?? platform;
  const match = available.find((a) => a.toLowerCase() === label.toLowerCase() || a.toLowerCase().includes(label.toLowerCase()));
  return match ?? label;
}

function clean(s: string | null | undefined, max = 500): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}

function validUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return ["http:", "https:"].includes(u.protocol) ? u.toString().slice(0, 2000) : null;
  } catch {
    return null;
  }
}

export type MappedSocialFields = {
  title: string;
  publish_date: string | null;
  publish_time: string | null;
  draft_due_date: string | null;
  approval_due_date: string | null;
  status: SocialStatus | null;
  status_label: string | null;
  platform: SocialPost["platform"];
  brand: string | null;
  caption: string | null;
  published_url: string | null;
  approver: string | null;
  notes: string | null;
  linked_event_item_ids: string[];
  event_text: string | null;
};

export function mapItemToSocialPost(item: MondayItem, map: SocialColumnMap, statusMap: Record<string, string>): MappedSocialFields {
  const byId = new Map(item.column_values.map((c) => [c.id, c]));
  const col = (key: keyof SocialColumnMap): MondayColumnValue | undefined => {
    const id = map[key];
    return id && id !== NAME_COLUMN ? byId.get(id) : undefined;
  };
  const publish = readDateColumn(col("publish_date"));
  const statusCol = col("status");
  const statusLabel = clean(statusCol?.label ?? statusCol?.text, 100);
  const link = col("event_link");
  const pub = col("published_url");
  return {
    title: clean(col("name")?.text, 300) ?? clean(item.name, 300) ?? "Untitled post",
    publish_date: publish.start,
    publish_time: publish.time,
    draft_due_date: readDateColumn(col("draft_due")).start,
    approval_due_date: readDateColumn(col("approval_due")).start,
    status: labelToStatus(statusLabel, statusMap),
    status_label: statusLabel,
    platform: platformFromText(col("platform")?.text),
    brand: clean(col("brand")?.text, 120),
    caption: clean(col("caption")?.text, 20000),
    published_url: validUrl(pub?.url ?? pub?.text),
    approver: clean(col("approver")?.text, 200),
    notes: clean(col("notes")?.text, 20000),
    linked_event_item_ids: (link?.linked_item_ids ?? []).map(String),
    event_text: clean(link?.display_value ?? link?.text, 300),
  };
}

export type ColumnInfo = { id: string; type: string; settings_str?: string | null };

/**
 * Builds Monday's column_values JSON for a post. Only mapped columns are written; unmapped
 * fields stay local. Status is written only when an explicit label mapping exists.
 */
export function buildColumnValues(post: SocialPost, map: SocialColumnMap, statusMap: Record<string, string>, columns: ColumnInfo[], event: { mondayItemId: string | null; name: string | null } | null): Record<string, unknown> {
  const types = new Map(columns.map((c) => [c.id, c]));
  const out: Record<string, unknown> = {};
  const set = (key: keyof SocialColumnMap, make: (col: ColumnInfo) => unknown) => {
    const id = map[key];
    if (!id || id === NAME_COLUMN) return;
    const col = types.get(id) ?? { id, type: "text" };
    const v = make(col);
    if (v !== undefined) out[id] = v;
  };
  const dateValue = (d: string | null, t?: string | null) => (d ? { date: d, ...(t ? { time: t.length === 5 ? `${t}:00` : t } : {}) } : { date: null });
  const textValue = (col: ColumnInfo, s: string | null) => (col.type === "long_text" ? { text: s ?? "" } : (s ?? ""));
  const labelValue = (col: ColumnInfo, label: string | null) => {
    if (!label) return col.type === "dropdown" ? { labels: [] } : col.type === "status" ? { label: "" } : "";
    if (col.type === "dropdown") return { labels: [label] };
    if (col.type === "status") return { label };
    return label;
  };

  if (map.name && map.name !== NAME_COLUMN) out[map.name] = post.title;
  set("publish_date", (col) => (col.type === "timeline" ? (post.publish_date ? { from: post.publish_date, to: post.publish_date } : { from: null, to: null }) : dateValue(post.publish_date, post.publish_time)));
  set("draft_due", () => dateValue(post.draft_due_date));
  set("approval_due", () => dateValue(post.approval_due_date));
  set("status", (col) => {
    const label = statusToLabel(post.status, statusMap);
    return label ? labelValue(col, label) : undefined;
  });
  set("platform", (col) => labelValue(col, platformToLabel(post.platform, parseColumnLabels(col))));
  set("brand", (col) => labelValue(col, post.brand));
  set("caption", (col) => textValue(col, post.caption));
  set("published_url", (col) => (col.type === "link" ? { url: post.published_url ?? "", text: post.published_url ? "Published post" : "" } : (post.published_url ?? "")));
  set("notes", (col) => textValue(col, post.notes));
  set("event_link", (col) => {
    if (col.type === "board_relation") return event?.mondayItemId ? { item_ids: [Number(event.mondayItemId)] } : { item_ids: [] };
    return event?.name ?? "";
  });
  return out;
}
