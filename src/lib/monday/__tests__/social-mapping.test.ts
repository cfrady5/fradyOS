import { describe, expect, it } from "vitest";
import { buildColumnValues, labelToStatus, mapItemToSocialPost, parseColumnLabels, platformFromText, statusToLabel } from "../social-mapping";
import type { MondayItem } from "../client";
import type { SocialPost } from "@/lib/types";

const item: MondayItem = {
  id: "77", name: "Two-weeks-out promotion", url: "https://m/77", state: "active", updated_at: null, group: null,
  column_values: [
    { id: "pub", type: "date", text: "2026-10-01 09:00", value: null, date: "2026-10-01", time: "09:00:00" },
    { id: "draft", type: "date", text: "", value: null, date: "2026-09-26" },
    { id: "st", type: "status", text: "Needs approval", value: null, label: "Needs approval" },
    { id: "plat", type: "dropdown", text: "LinkedIn", value: null },
    { id: "cap", type: "long_text", text: " Join us at the gala ", value: null },
    { id: "ev", type: "board_relation", text: "Fall Gala", value: null, linked_item_ids: ["123"], display_value: "Fall Gala" },
    { id: "url", type: "link", text: "", value: null, url: "linkedin.com/posts/abc", url_text: "" },
  ],
};
const map = { name: "__name__", publish_date: "pub", draft_due: "draft", status: "st", platform: "plat", caption: "cap", event_link: "ev", published_url: "url" };

describe("social board mapping", () => {
  it("reads an item into post fields", () => {
    const f = mapItemToSocialPost(item, map, { awaiting_approval: "Needs approval" });
    expect(f).toMatchObject({ title: "Two-weeks-out promotion", publish_date: "2026-10-01", publish_time: "09:00:00", draft_due_date: "2026-09-26", status: "awaiting_approval", platform: "linkedin", caption: "Join us at the gala", published_url: "https://linkedin.com/posts/abc", linked_event_item_ids: ["123"], event_text: "Fall Gala" });
  });

  it("maps status labels explicitly first, then by keyword", () => {
    expect(labelToStatus("Posted", {})).toBe("published");
    expect(labelToStatus("Working on it", {})).toBe("drafting");
    expect(labelToStatus("Stuck", {})).toBeNull();
    expect(labelToStatus("Stuck", { idea: "Stuck" })).toBe("idea");
    expect(statusToLabel("ready", { ready: "Approved" })).toBe("Approved");
    expect(statusToLabel("ready", {})).toBeNull();
  });

  it("parses labels from status and dropdown settings", () => {
    expect(parseColumnLabels({ type: "status", settings_str: '{"labels":{"0":"Working on it","1":"Done","2":"Stuck"}}' })).toEqual(["Working on it", "Done", "Stuck"]);
    expect(parseColumnLabels({ type: "dropdown", settings_str: '{"settings":{"labels":[{"id":1,"name":"LinkedIn"},{"id":2,"name":"Instagram"}]}}' })).toEqual(["LinkedIn", "Instagram"]);
    expect(parseColumnLabels({ type: "text", settings_str: "{}" })).toEqual([]);
    expect(platformFromText("Twitter")).toBe("x");
  });

  it("builds column_values for writing, skipping unmapped statuses", () => {
    const post = { title: "Day-of post", publish_date: "2026-10-05", publish_time: "08:30", draft_due_date: "2026-10-04", approval_due_date: null, status: "drafting", platform: "instagram", brand: "ARI", caption: "We're live!", published_url: null, notes: null } as unknown as SocialPost;
    const columns = [
      { id: "pub", type: "date" }, { id: "draft", type: "date" }, { id: "st", type: "status", settings_str: '{"labels":{"0":"Draft","1":"Done"}}' },
      { id: "plat", type: "dropdown", settings_str: '{"settings":{"labels":[{"id":1,"name":"LinkedIn"},{"id":2,"name":"Instagram"}]}}' }, { id: "cap", type: "long_text" }, { id: "ev", type: "board_relation" }, { id: "url", type: "link" },
    ];
    const values = buildColumnValues(post, map, {}, columns, { mondayItemId: "123", name: "Fall Gala" });
    expect(values).toEqual({
      pub: { date: "2026-10-05", time: "08:30:00" },
      draft: { date: "2026-10-04" },
      plat: { labels: ["Instagram"] },
      cap: { text: "We're live!" },
      url: { url: "", text: "" },
      ev: { item_ids: [123] },
    });
    const withStatus = buildColumnValues(post, map, { drafting: "Draft" }, columns, null);
    expect(withStatus.st).toEqual({ label: "Draft" });
    expect(withStatus.ev).toEqual({ item_ids: [] });
  });
});
