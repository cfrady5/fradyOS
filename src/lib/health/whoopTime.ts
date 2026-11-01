/**
 * WHOOP timestamps are local wall-clock strings ("2026-03-04 06:12:00") with the zone in a separate
 * "Cycle timezone" column ("UTC-05:00", "UTC+01:00", "UTC"). These helpers turn them into ISO instants
 * and local day keys.
 */
export function tzOffsetMinutes(tz: string | undefined): number {
  if (!tz) return 0;
  const m = tz.trim().match(/^(?:UTC|GMT|Z)?\s*([+-])?(\d{1,2})(?::?(\d{2}))?$/i);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** "2026-03-04 06:12:00" in a zone -> ISO 8601 UTC instant, or null. */
export function toInstant(local: string | undefined, tz: string | undefined): string | null {
  if (!local) return null;
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  const d = new Date(utc - tzOffsetMinutes(tz) * 60_000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The local calendar day ("2026-03-04") of a WHOOP local timestamp. */
export function localDay(local: string | undefined): string | null {
  const m = local?.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * The wake day of a cycle: the local date twelve hours after the cycle began. A cycle starts at sleep
 * onset in the evening, so this lands on the morning the recovery belongs to; a cycle starting after
 * midnight stays on the same date. Every health row is keyed by this day.
 */
export function wakeDay(local: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec((local ?? "").trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0) + 12 * 3_600_000;
  return new Date(t).toISOString().slice(0, 10);
}
