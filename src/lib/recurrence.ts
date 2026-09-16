import { addDays, addMonths, addYears, startOfWeek, weekday, diffDays, type DateOnly } from "@/lib/dates";
import type { RecurrenceRule } from "@/lib/types";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Next occurrence strictly after `from` for the rule. Returns null when the rule has ended.
 */
export function nextOccurrence(rule: RecurrenceRule, from: DateOnly): DateOnly | null {
  const interval = Math.max(1, rule.interval || 1);
  let next: DateOnly | null = null;

  switch (rule.freq) {
    case "daily":
      next = addDays(from, interval);
      break;
    case "weekly": {
      const days = (rule.byWeekday ?? []).filter((d) => d >= 0 && d <= 6);
      if (days.length === 0) {
        next = addDays(from, 7 * interval);
      } else {
        const set = new Set(days);
        const baseWeek = startOfWeek(from, 0);
        // Search up to interval weeks + 1 ahead, day by day.
        for (let i = 1; i <= 7 * (interval + 1); i++) {
          const cand = addDays(from, i);
          if (!set.has(weekday(cand))) continue;
          const weeksApart = Math.round(diffDays(baseWeek, startOfWeek(cand, 0)) / 7);
          if (weeksApart % interval === 0) {
            next = cand;
            break;
          }
        }
      }
      break;
    }
    case "monthly":
      next = addMonths(from, interval);
      break;
    case "yearly":
      next = addYears(from, interval);
      break;
  }

  if (next && rule.until && next > rule.until) return null;
  return next;
}

export function describeRecurrence(rule: RecurrenceRule | null | undefined): string {
  if (!rule) return "Does not repeat";
  const n = Math.max(1, rule.interval || 1);
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  let base: string;
  switch (rule.freq) {
    case "daily":
      base = every("day");
      break;
    case "weekly": {
      const days = (rule.byWeekday ?? []).slice().sort((a, b) => a - b);
      base = days.length ? `${every("week")} on ${days.map((d) => WEEKDAY_SHORT[d]).join(", ")}` : every("week");
      break;
    }
    case "monthly":
      base = every("month");
      break;
    case "yearly":
      base = every("year");
      break;
    default:
      base = "Repeats";
  }
  const basis = rule.basis === "completion" ? " after completion" : "";
  const until = rule.until ? ` until ${rule.until}` : "";
  return base + basis + until;
}
