import { describe, expect, it } from "vitest";
import { describeRecurrence, nextOccurrence } from "../recurrence";

describe("recurrence", () => {
  it("daily with interval", () => {
    expect(nextOccurrence({ freq: "daily", interval: 1, basis: "due" }, "2026-09-16")).toBe("2026-09-17");
    expect(nextOccurrence({ freq: "daily", interval: 3, basis: "due" }, "2026-09-16")).toBe("2026-09-19");
  });

  it("weekly on specific weekdays", () => {
    // Wed Sep 16 → Mon/Wed/Fri rule → Fri Sep 18
    expect(nextOccurrence({ freq: "weekly", interval: 1, byWeekday: [1, 3, 5], basis: "due" }, "2026-09-16")).toBe("2026-09-18");
    // Fri Sep 18 → Mon Sep 21
    expect(nextOccurrence({ freq: "weekly", interval: 1, byWeekday: [1, 3, 5], basis: "due" }, "2026-09-18")).toBe("2026-09-21");
    // Every 2 weeks on Monday: from Mon Sep 14 → Mon Sep 28
    expect(nextOccurrence({ freq: "weekly", interval: 2, byWeekday: [1], basis: "due" }, "2026-09-14")).toBe("2026-09-28");
    // No weekdays → plain 7-day step
    expect(nextOccurrence({ freq: "weekly", interval: 1, basis: "due" }, "2026-09-16")).toBe("2026-09-23");
  });

  it("monthly clamps to month end and yearly handles leap days", () => {
    expect(nextOccurrence({ freq: "monthly", interval: 1, basis: "due" }, "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence({ freq: "yearly", interval: 1, basis: "due" }, "2028-02-29")).toBe("2029-02-28");
  });

  it("respects until", () => {
    expect(nextOccurrence({ freq: "daily", interval: 1, basis: "due", until: "2026-09-16" }, "2026-09-16")).toBeNull();
    expect(nextOccurrence({ freq: "daily", interval: 1, basis: "due", until: "2026-09-17" }, "2026-09-16")).toBe("2026-09-17");
  });

  it("describes rules", () => {
    expect(describeRecurrence(null)).toBe("Does not repeat");
    expect(describeRecurrence({ freq: "weekly", interval: 2, byWeekday: [1, 4], basis: "completion" })).toBe("Every 2 weeks on Mon, Thu after completion");
  });
});
