import type { MondayColumnMap } from "@/lib/types";
import type { MondayColumnValue, MondayItem } from "./client";

export const NAME_COLUMN = "__name__";

export type MappedEventFields = {
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
};

/** Which Monday column types are sensible for each mapped field. */
export const FIELD_COLUMN_TYPES: Record<keyof MondayColumnMap, string[]> = {
  name: ["name", "text", "long_text", "formula", "mirror"],
  start: ["date", "timeline", "creation_log", "last_updated", "formula", "mirror"],
  end: ["date", "timeline", "formula", "mirror"],
  location: ["location", "text", "long_text", "dropdown", "formula", "mirror"],
  program: ["dropdown", "status", "text", "tags", "board_relation", "mirror", "formula"],
  owner: ["people", "person", "text", "email", "mirror", "formula"],
  status: ["status", "dropdown", "text", "checkbox", "mirror", "formula"],
  website: ["link", "text", "long_text", "mirror", "formula"],
  notes: ["long_text", "text", "doc", "mirror", "formula"],
};

export const FIELD_LABELS: Record<keyof MondayColumnMap, { label: string; hint: string }> = {
  name: { label: "Event name", hint: "Defaults to the item name." },
  start: { label: "Start date", hint: "A Date or Timeline column. Timelines also provide the end date." },
  end: { label: "End date", hint: "Optional. Ignored when the start column is a Timeline." },
  location: { label: "Location", hint: "Location or text column." },
  program: { label: "Program / work area", hint: "Matched to a work area with the same name when possible." },
  owner: { label: "Event owner", hint: "People or text column." },
  status: { label: "Event status", hint: "Status column. Canceled labels are flagged for review." },
  website: { label: "Registration / event website", hint: "Link column." },
  notes: { label: "Relevant notes", hint: "Long text column." },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(s: string | null | undefined, max = 500): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function cleanMultiline(s: string | null | undefined, max = 20000): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}

function safeJson(v: string | null | undefined): Record<string, unknown> | null {
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function validDate(v: unknown): string | null {
  return typeof v === "string" && DATE_RE.test(v) ? v : null;
}

function validTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  return m ? `${m[1]}:${m[2]}:${m[3] ?? "00"}` : null;
}

function validUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return u.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

/** Reads start/end/time from a Date or Timeline column value. */
export function readDateColumn(cv: MondayColumnValue | undefined): { start: string | null; end: string | null; time: string | null } {
  if (!cv) return { start: null, end: null, time: null };
  const json = safeJson(cv.value);
  if (cv.type === "timeline") {
    const from = validDate(cv.from) ?? validDate(json?.from);
    const to = validDate(cv.to) ?? validDate(json?.to);
    return { start: from, end: to && from && to !== from ? to : null, time: null };
  }
  if (cv.type === "date" || cv.type === "creation_log" || cv.type === "last_updated") {
    const date = validDate(cv.date) ?? validDate(json?.date) ?? validDate(cv.text?.slice(0, 10));
    const time = validTime(cv.time) ?? validTime(json?.time);
    return { start: date, end: null, time };
  }
  // Formula / mirror columns expose text only.
  const text = cv.text?.trim() ?? "";
  const range = text.match(/^(\d{4}-\d{2}-\d{2})\s*[-–]\s*(\d{4}-\d{2}-\d{2})$/);
  if (range) return { start: range[1], end: range[2] !== range[1] ? range[2] : null, time: null };
  return { start: validDate(text.slice(0, 10)), end: null, time: null };
}

export function mapItemToEvent(item: MondayItem, map: MondayColumnMap): MappedEventFields {
  const byId = new Map(item.column_values.map((c) => [c.id, c]));
  const col = (key: keyof MondayColumnMap) => {
    const id = map[key];
    return id && id !== NAME_COLUMN ? byId.get(id) : undefined;
  };

  const nameCol = col("name");
  const name = clean(nameCol?.text, 300) ?? clean(item.name, 300) ?? "Untitled event";

  const startCol = col("start");
  const startRead = readDateColumn(startCol);
  let start_date = startRead.start;
  let end_date = startRead.end;
  const start_time = startRead.time;
  if (startCol?.type !== "timeline") {
    const endRead = readDateColumn(col("end"));
    end_date = endRead.start ?? endRead.end ?? null;
  }
  if (start_date && end_date && end_date < start_date) {
    [start_date, end_date] = [end_date, start_date];
  }
  if (end_date === start_date) end_date = null;

  const statusCol = col("status");
  const status = clean(statusCol?.label ?? statusCol?.text, 100);
  const locCol = col("location");
  const location = clean(locCol?.address ?? locCol?.text, 500);
  const webCol = col("website");
  const website_url = validUrl(webCol?.url ?? webCol?.text);

  return {
    name,
    start_date,
    end_date,
    start_time,
    location,
    program: clean(col("program")?.text, 200),
    owner: clean(col("owner")?.text, 200),
    status,
    website_url,
    notes: cleanMultiline(col("notes")?.text),
  };
}

export function mappedColumnIds(map: MondayColumnMap): string[] {
  return Array.from(new Set(Object.values(map).filter((v): v is string => Boolean(v) && v !== NAME_COLUMN)));
}

export function isCanceledStatus(status: string | null, canceledLabels: string[]): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return canceledLabels.some((l) => l && s.includes(l.toLowerCase()));
}
