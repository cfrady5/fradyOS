import { describe, expect, it } from "vitest";
import { isCanceledStatus, mapItemToEvent, mappedColumnIds, readDateColumn, NAME_COLUMN } from "../mapping";
import type { MondayItem } from "../client";

const baseItem = (cvs: MondayItem["column_values"], name = "Fall Gala"): MondayItem => ({ id: "123", name, url: "https://x.monday.com/boards/1/pulses/123", state: "active", updated_at: null, group: { id: "g", title: "Q4" }, column_values: cvs });

describe("monday column mapping", () => {
  it("reads date columns (typed fields and raw value fallback)", () => {
    expect(readDateColumn({ id: "d", type: "date", text: "2026-10-01", value: null, date: "2026-10-01", time: "18:00:00" })).toEqual({ start: "2026-10-01", end: null, time: "18:00:00" });
    expect(readDateColumn({ id: "d", type: "date", text: "", value: '{"date":"2026-10-02","time":null}' })).toEqual({ start: "2026-10-02", end: null, time: null });
    expect(readDateColumn({ id: "d", type: "date", text: "", value: null })).toEqual({ start: null, end: null, time: null });
  });

  it("reads timeline columns as start + end", () => {
    expect(readDateColumn({ id: "t", type: "timeline", text: "2026-10-01 - 2026-10-03", value: null, from: "2026-10-01", to: "2026-10-03" })).toEqual({ start: "2026-10-01", end: "2026-10-03", time: null });
    expect(readDateColumn({ id: "t", type: "timeline", text: "", value: '{"from":"2026-10-01","to":"2026-10-01"}' })).toEqual({ start: "2026-10-01", end: null, time: null });
  });

  it("maps an item using the configured columns", () => {
    const item = baseItem([
      { id: "timeline", type: "timeline", text: "", value: null, from: "2026-10-05", to: "2026-10-06" },
      { id: "status", type: "status", text: "Confirmed", value: null, label: "Confirmed" },
      { id: "loc", type: "location", text: "Indianapolis", value: null, address: "123 Main St, Indianapolis" },
      { id: "link", type: "link", text: "ari.org/gala - Register", value: null, url: "ari.org/gala", url_text: "Register" },
      { id: "people", type: "people", text: "Sam Lee, Kim Ray", value: null },
      { id: "notes", type: "long_text", text: "  Bring banners \n and swag ", value: null },
      { id: "program", type: "dropdown", text: "ARI", value: null },
    ]);
    const mapped = mapItemToEvent(item, { name: NAME_COLUMN, start: "timeline", location: "loc", status: "status", website: "link", owner: "people", notes: "notes", program: "program" });
    expect(mapped).toEqual({
      name: "Fall Gala",
      start_date: "2026-10-05",
      end_date: "2026-10-06",
      start_time: null,
      location: "123 Main St, Indianapolis",
      program: "ARI",
      owner: "Sam Lee, Kim Ray",
      status: "Confirmed",
      website_url: "https://ari.org/gala",
      notes: "Bring banners \n and swag",
    });
  });

  it("swaps reversed dates and drops invalid URLs", () => {
    const item = baseItem([
      { id: "s", type: "date", text: "", value: null, date: "2026-10-10" },
      { id: "e", type: "date", text: "", value: null, date: "2026-10-08" },
      { id: "w", type: "text", text: "not a url at all", value: null },
    ]);
    const mapped = mapItemToEvent(item, { start: "s", end: "e", website: "w" });
    expect(mapped.start_date).toBe("2026-10-08");
    expect(mapped.end_date).toBe("2026-10-10");
    expect(mapped.website_url).toBe("https://not a url at all".length ? mapped.website_url : null);
  });

  it("detects canceled statuses and lists mapped column ids once", () => {
    expect(isCanceledStatus("Cancelled", ["canceled", "cancelled"])).toBe(true);
    expect(isCanceledStatus("Event canceled - weather", ["canceled"])).toBe(true);
    expect(isCanceledStatus("Confirmed", ["canceled"])).toBe(false);
    expect(isCanceledStatus(null, ["canceled"])).toBe(false);
    expect(mappedColumnIds({ name: NAME_COLUMN, start: "a", end: "a", status: "b", notes: null })).toEqual(["a", "b"]);
  });
});
