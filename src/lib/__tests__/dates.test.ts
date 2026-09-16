import { describe, expect, it } from "vitest";
import { addDays, addMonths, diffDays, dueBucket, endOfWeek, formatDate, monthGrid, relativeDayLabel, startOfWeek, todayIn, dateOnlyIn, isoToDateOnly, formatTime, weekday } from "../dates";

describe("date-only helpers never shift days", () => {
  it("computes today in America/Indiana/Indianapolis, not UTC", () => {
    // 2026-09-17T03:30Z is still Sep 16 in Indianapolis (UTC-4 in September).
    expect(todayIn("America/Indiana/Indianapolis", new Date("2026-09-17T03:30:00Z"))).toBe("2026-09-16");
    expect(todayIn("UTC", new Date("2026-09-17T03:30:00Z"))).toBe("2026-09-17");
    // In winter (UTC-5), 04:30Z is still the previous day.
    expect(dateOnlyIn(new Date("2026-01-10T04:30:00Z"), "America/Indiana/Indianapolis")).toBe("2026-01-09");
  });

  it("adds days across the US DST transition without skipping", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("adds months with end-of-month clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
  });

  it("diffDays is exact across DST", () => {
    expect(diffDays("2026-03-01", "2026-03-31")).toBe(30);
    expect(diffDays("2026-09-20", "2026-09-16")).toBe(-4);
  });

  it("week boundaries respect weekStartsOn", () => {
    // 2026-09-16 is a Wednesday
    expect(weekday("2026-09-16")).toBe(3);
    expect(startOfWeek("2026-09-16", 1)).toBe("2026-09-14");
    expect(endOfWeek("2026-09-16", 1)).toBe("2026-09-20");
    expect(startOfWeek("2026-09-16", 0)).toBe("2026-09-13");
    expect(startOfWeek("2026-09-14", 1)).toBe("2026-09-14");
  });

  it("month grid covers whole weeks", () => {
    const grid = monthGrid("2026-09-16", 1);
    expect(grid[0][0]).toBe("2026-08-31");
    expect(grid.at(-1)!.at(-1)).toBe("2026-10-04");
    grid.forEach((w) => expect(w).toHaveLength(7));
  });

  it("formats without touching UTC", () => {
    expect(formatDate("2026-09-16", "medium", "2026-09-16")).toBe("Sep 16");
    expect(formatDate("2025-12-31", "medium", "2026-09-16")).toBe("Dec 31, 2025");
    expect(formatDate("2026-09-16", "weekday")).toBe("Wed, Sep 16");
    expect(formatDate("2026-09-16", "long")).toBe("Wednesday, September 16, 2026");
  });

  it("relative labels and buckets", () => {
    const today = "2026-09-16";
    expect(relativeDayLabel("2026-09-16", today)).toBe("Today");
    expect(relativeDayLabel("2026-09-17", today)).toBe("Tomorrow");
    expect(relativeDayLabel("2026-09-15", today)).toBe("Yesterday");
    expect(relativeDayLabel("2026-09-19", today)).toBe("Sat");
    expect(dueBucket("2026-09-10", today)).toBe("overdue");
    expect(dueBucket("2026-09-16", today)).toBe("today");
    expect(dueBucket("2026-09-23", today)).toBe("week");
    expect(dueBucket("2026-09-24", today)).toBe("later");
    expect(dueBucket(null, today)).toBe("none");
  });

  it("maps completion timestamps to the user's local day", () => {
    expect(isoToDateOnly("2026-09-17T02:00:00Z", "America/Indiana/Indianapolis")).toBe("2026-09-16");
  });

  it("formats times", () => {
    expect(formatTime("09:05:00")).toBe("9:05 AM");
    expect(formatTime("13:30")).toBe("1:30 PM");
    expect(formatTime("00:00:00")).toBe("12:00 AM");
  });
});
