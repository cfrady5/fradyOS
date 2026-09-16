import { describe, expect, it } from "vitest";
import { previewTemplate, proposeDateChanges } from "../templates";
import type { EventTemplateItem, SocialPost, Task } from "../types";

const item = (over: Partial<EventTemplateItem>): EventTemplateItem => ({
  id: over.id ?? "i1",
  template_id: "t1",
  user_id: "u1",
  kind: "social",
  title: "Post",
  description: null,
  offset_days: -14,
  platform: null,
  brand: null,
  draft_lead_days: 5,
  approval_lead_days: 2,
  sort_order: 0,
  ...over,
});

describe("template preview", () => {
  it("computes dates relative to the event start and flags past/applied items", () => {
    const items = [item({ id: "a", offset_days: -30 }), item({ id: "b", offset_days: 0, kind: "task", draft_lead_days: null, approval_lead_days: null }), item({ id: "c", offset_days: 1 })];
    const rows = previewTemplate(items, "2026-10-01", "2026-09-16", { tasks: [{ template_item_id: "b" }], posts: [] });
    expect(rows.map((r) => r.date)).toEqual(["2026-09-01", "2026-10-01", "2026-10-02"]);
    expect(rows[0].in_past).toBe(true);
    expect(rows[0].draft_due_date).toBe("2026-08-27");
    expect(rows[0].approval_due_date).toBe("2026-08-30");
    expect(rows[1].already_applied).toBe(true);
    expect(rows[1].draft_due_date).toBeNull();
    expect(rows[2].in_past).toBe(false);
  });
});

const task = (over: Partial<Task>): Task => ({
  id: "t", user_id: "u", work_area_id: null, project_id: null, event_id: "e", title: "Prep", description: null, status: "todo", priority: "normal",
  planned_date: null, due_date: "2026-09-24", due_time: null, estimated_minutes: null, links: [], notes: null, recurrence: null, recurrence_parent_id: null,
  focus_rank: null, sort_order: 0, waiting_person: null, waiting_need: null, waiting_requested_date: null, waiting_expected_date: null, waiting_followup_date: null,
  waiting_last_followup_date: null, waiting_notes: null, waiting_received_at: null, template_item_id: "i", anchor_date: "2026-10-01", offset_days: -7, date_overridden: false,
  created_at: "", updated_at: "", completed_at: null, ...over,
});

const post = (over: Partial<SocialPost>): SocialPost => ({
  id: "p", user_id: "u", work_area_id: null, project_id: null, event_id: "e", title: "Promo", brand: null, platform: "linkedin", draft_due_date: "2026-09-12", approval_due_date: "2026-09-15",
  publish_date: "2026-09-17", publish_time: null, status: "drafting", approver: null, followup_date: null, caption: null, assets: [], published_url: null, notes: null,
  template_item_id: "i2", anchor_date: "2026-10-01", offset_days: -14, date_overridden: false, created_at: "", updated_at: "", published_at: null, ...over,
});

describe("event move proposals", () => {
  it("proposes shifted dates only for unfinished, non-overridden template items", () => {
    const proposals = proposeDateChanges("2026-10-08", [task({}), task({ id: "done", status: "completed", completed_at: "x" }), task({ id: "manual", date_overridden: true }), task({ id: "adhoc", template_item_id: null })], [post({}), post({ id: "pub", status: "published", published_at: "x" })]);
    expect(proposals.map((p) => p.id)).toEqual(["t", "p"]);
    expect(proposals[0].proposed.date).toBe("2026-10-01");
    // Social: publish shifts by 7 days, draft/approval shift by the same delta.
    expect(proposals[1].proposed).toEqual({ date: "2026-09-24", draft: "2026-09-19", approval: "2026-09-22" });
  });

  it("proposes nothing when the event has not moved", () => {
    expect(proposeDateChanges("2026-10-01", [task({})], [post({})])).toEqual([]);
    expect(proposeDateChanges(null, [task({})], [post({})])).toEqual([]);
  });
});
