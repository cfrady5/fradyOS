import { describe, expect, it } from "vitest";
import { taskInputSchema, socialPostInputSchema } from "../validation";

describe("task input validation", () => {
  it("normalizes empty strings to null and keeps date-only strings intact", () => {
    const r = taskInputSchema.safeParse({ title: "  Write brief ", due_date: "2026-09-30", planned_date: "", due_time: "", project_id: "", estimated_minutes: "45" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBe("Write brief");
      expect(r.data.due_date).toBe("2026-09-30");
      expect(r.data.planned_date).toBeNull();
      expect(r.data.due_time).toBeNull();
      expect(r.data.project_id).toBeNull();
      expect(r.data.estimated_minutes).toBe(45);
      expect(r.data.status).toBeUndefined();
    }
  });
  it("partial updates never reset untouched fields to defaults", () => {
    const r = taskInputSchema.partial().safeParse({ status: "completed" });
    expect(r.success).toBe(true);
    if (r.success) expect(Object.keys(r.data)).toEqual(["status"]);
    const p = socialPostInputSchema.partial().safeParse({ publish_date: "2026-10-01" });
    expect(p.success).toBe(true);
    if (p.success) expect(Object.keys(p.data)).toEqual(["publish_date"]);
  });
  it("rejects impossible dates and empty titles", () => {
    expect(taskInputSchema.safeParse({ title: "x", due_date: "2026-02-30" }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "   " }).success).toBe(false);
  });
  it("validates social post URLs", () => {
    expect(socialPostInputSchema.safeParse({ title: "Post", published_url: "not a url" }).success).toBe(false);
    expect(socialPostInputSchema.safeParse({ title: "Post", published_url: "", platform: "" }).success).toBe(true);
  });
});
