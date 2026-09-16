import { describe, expect, it } from "vitest";
import { toCsv, summaryMarkdown, groupSummary } from "../summary";

describe("csv", () => {
  it("escapes commas, quotes and newlines", () => {
    const csv = toCsv([{ a: 'He said "hi"', b: "x,y", c: "line\nbreak", d: null }]);
    expect(csv.split("\r\n")[0]).toBe("a,b,c,d");
    expect(csv.split("\r\n")[1]).toBe('"He said ""hi""","x,y","line\nbreak",');
  });
  it("returns empty for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});

describe("summary", () => {
  it("does not invent accomplishments", () => {
    const md = summaryMarkdown({ from: "2026-09-14", to: "2026-09-20", groups: groupSummary([], [], [], "project"), carryOver: [], timeZone: "UTC", by: "project" });
    expect(md).toContain("No tasks completed, posts published or projects closed in this period.");
  });
});
