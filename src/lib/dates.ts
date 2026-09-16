/**
 * Date helpers for FRADY OS.
 *
 * Two kinds of values flow through the app:
 *  - Date-only strings ("YYYY-MM-DD") for deadlines, planned dates and event dates.
 *    These are never converted through a UTC Date, so the day never shifts.
 *  - ISO timestamps (timestamptz) for created/completed/synced times, displayed in
 *    the user's time zone.
 */

export const DEFAULT_TIMEZONE = "America/Indiana/Indianapolis";

export type DateOnly = string; // YYYY-MM-DD

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(v: unknown): v is DateOnly {
  return typeof v === "string" && DATE_ONLY_RE.test(v);
}

/** Today's date (YYYY-MM-DD) in the given IANA time zone. */
export function todayIn(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): DateOnly {
  return dateOnlyIn(now, timeZone);
}

/** Convert an instant to a date-only string in a time zone. */
export function dateOnlyIn(instant: Date, timeZone: string = DEFAULT_TIMEZONE): DateOnly {
  // en-CA yields YYYY-MM-DD ordering.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Parse a date-only string into local Y/M/D components. */
export function parseDateOnly(s: DateOnly): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return { y, m, d };
}

/** Build a local Date at local midnight for a date-only string (safe for local math/formatting). */
export function toLocalDate(s: DateOnly): Date {
  const { y, m, d } = parseDateOnly(s);
  return new Date(y, m - 1, d, 12, 0, 0, 0); // noon avoids DST edge cases
}

/** Format a local Date's local components as YYYY-MM-DD. */
export function fromLocalDate(d: Date): DateOnly {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(s: DateOnly, n: number): DateOnly {
  const d = toLocalDate(s);
  d.setDate(d.getDate() + n);
  return fromLocalDate(d);
}

export function addMonths(s: DateOnly, n: number): DateOnly {
  const { y, m, d } = parseDateOnly(s);
  const target = new Date(y, m - 1 + n, 1, 12);
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, daysInTarget));
  return fromLocalDate(target);
}

export function addYears(s: DateOnly, n: number): DateOnly {
  return addMonths(s, n * 12);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: DateOnly, b: DateOnly): number {
  const da = toLocalDate(a);
  const db = toLocalDate(b);
  const utcA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const utcB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((utcB - utcA) / 86_400_000);
}

export function compareDateOnly(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(...ds: (DateOnly | null | undefined)[]): DateOnly | null {
  const xs = ds.filter((d): d is DateOnly => Boolean(d));
  if (!xs.length) return null;
  return xs.reduce((m, d) => (d < m ? d : m));
}

/** 0 = Sunday ... 6 = Saturday, computed locally. */
export function weekday(s: DateOnly): number {
  return toLocalDate(s).getDay();
}

/** Start of the week containing s. weekStartsOn: 0 = Sunday, 1 = Monday. */
export function startOfWeek(s: DateOnly, weekStartsOn: 0 | 1 = 1): DateOnly {
  const wd = weekday(s);
  const delta = (wd - weekStartsOn + 7) % 7;
  return addDays(s, -delta);
}

export function endOfWeek(s: DateOnly, weekStartsOn: 0 | 1 = 1): DateOnly {
  return addDays(startOfWeek(s, weekStartsOn), 6);
}

export function startOfMonth(s: DateOnly): DateOnly {
  const { y, m } = parseDateOnly(s);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export function endOfMonth(s: DateOnly): DateOnly {
  const { y, m } = parseDateOnly(s);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export function eachDay(from: DateOnly, to: DateOnly): DateOnly[] {
  const out: DateOnly[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type DateStyle = "short" | "medium" | "long" | "weekday" | "monthDay" | "monthYear" | "iso";

/** Format a date-only string without touching UTC. */
export function formatDate(s: DateOnly | null | undefined, style: DateStyle = "medium", today?: DateOnly): string {
  if (!s) return "";
  const { y, m, d } = parseDateOnly(s);
  const wd = weekday(s);
  const sameYear = today ? parseDateOnly(today).y === y : true;
  switch (style) {
    case "iso":
      return s;
    case "short":
      return `${m}/${d}${sameYear ? "" : "/" + String(y).slice(2)}`;
    case "monthDay":
      return `${MONTHS[m - 1]} ${d}`;
    case "monthYear":
      return `${MONTHS_LONG[m - 1]} ${y}`;
    case "weekday":
      return `${WEEKDAYS[wd]}, ${MONTHS[m - 1]} ${d}${sameYear ? "" : ", " + y}`;
    case "long":
      return `${WEEKDAYS_LONG[wd]}, ${MONTHS_LONG[m - 1]} ${d}, ${y}`;
    case "medium":
    default:
      return `${MONTHS[m - 1]} ${d}${sameYear ? "" : ", " + y}`;
  }
}

export function formatDateRange(start: DateOnly | null | undefined, end: DateOnly | null | undefined, today?: DateOnly): string {
  if (!start) return "";
  if (!end || end === start) return formatDate(start, "weekday", today);
  const a = parseDateOnly(start);
  const b = parseDateOnly(end);
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m - 1]} ${a.d}–${b.d}${today && parseDateOnly(today).y === a.y ? "" : ", " + a.y}`;
  return `${formatDate(start, "medium", today)} – ${formatDate(end, "medium", today)}`;
}

/** Human label relative to today: Today, Tomorrow, Yesterday, weekday within a week, else date. */
export function relativeDayLabel(s: DateOnly, today: DateOnly): string {
  const diff = diffDays(today, s);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return WEEKDAYS[weekday(s)];
  if (diff < -1 && diff > -7) return `${-diff} days ago`;
  return formatDate(s, "medium", today);
}

/** "3 days overdue", "Due today", "Due in 2 days" style label. */
export function dueLabel(s: DateOnly | null | undefined, today: DateOnly): string {
  if (!s) return "No due date";
  const diff = diffDays(today, s);
  if (diff < 0) return `${-diff} day${diff === -1 ? "" : "s"} overdue`;
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  if (diff < 7) return `Due ${WEEKDAYS[weekday(s)]}`;
  return `Due ${formatDate(s, "medium", today)}`;
}

export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export function dueBucket(s: DateOnly | null | undefined, today: DateOnly): DueBucket {
  if (!s) return "none";
  const diff = diffDays(today, s);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= 7) return "week";
  return "later";
}

/** Format a Postgres time ("HH:MM" or "HH:MM:SS") to "9:30 AM". */
export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const [hh, mm] = t.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return t;
  const suffix = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/** Normalize "HH:MM" / "HH:MM:SS" to "HH:MM" for <input type="time">. */
export function timeInputValue(t: string | null | undefined): string {
  if (!t) return "";
  return t.slice(0, 5);
}

/** Format an ISO timestamp in the user's zone: "Sep 16, 3:04 PM". */
export function formatTimestamp(iso: string | null | undefined, timeZone: string = DEFAULT_TIMEZONE, opts: { withYear?: boolean; withSeconds?: boolean } = {}): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: opts.withYear ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
    second: opts.withSeconds ? "2-digit" : undefined,
  }).format(d);
}

/** Relative "5 min ago" / "2 h ago" / "3 d ago" for timestamps. */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const s = Math.max(0, Math.round((now.getTime() - d) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.round(days / 30);
  return `${months} mo ago`;
}

/** Month grid: array of weeks (each 7 date strings) covering the month with leading/trailing days. */
export function monthGrid(anyDayInMonth: DateOnly, weekStartsOn: 0 | 1 = 1): DateOnly[][] {
  const first = startOfMonth(anyDayInMonth);
  const last = endOfMonth(anyDayInMonth);
  const gridStart = startOfWeek(first, weekStartsOn);
  const gridEnd = endOfWeek(last, weekStartsOn);
  const days = eachDay(gridStart, gridEnd);
  const weeks: DateOnly[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

export function weekdayNames(weekStartsOn: 0 | 1 = 1): string[] {
  return weekStartsOn === 1 ? [...WEEKDAYS.slice(1), WEEKDAYS[0]] : [...WEEKDAYS];
}

/** Given a timestamptz ISO and zone, return "YYYY-MM-DD" (used for grouping completed items by day). */
export function isoToDateOnly(iso: string, timeZone: string = DEFAULT_TIMEZONE): DateOnly {
  return dateOnlyIn(new Date(iso), timeZone);
}

/** Combine a date-only + optional time into a local ISO-like string for sorting. */
export function sortKey(date: DateOnly | null | undefined, time?: string | null): string {
  if (!date) return "9999-12-31T99:99";
  return `${date}T${time ? time.slice(0, 5) : "99:99"}`;
}

/** ISO timestamp for N days before now (used for "recently completed" windows). */
export function isoDaysAgo(n: number, now: Date = new Date()): string {
  return new Date(now.getTime() - n * 86_400_000).toISOString();
}
