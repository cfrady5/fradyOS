import { describe, expect, it } from "vitest";
import { mondayTokenProblem } from "../client";

describe("MONDAY_API_TOKEN validation", () => {
  it("rejects placeholder text and empty values with a readable message", () => {
    expect(mondayTokenProblem(undefined)).toMatch(/not set/);
    expect(mondayTokenProblem("<your token from monday.com → avatar → Developers → My access tokens>")).toMatch(/placeholder/);
    expect(mondayTokenProblem("short")).toMatch(/too short/);
  });
  it("accepts a realistic token", () => {
    expect(mondayTokenProblem("eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjEyMzQ1Njc4OSwidWlkIjo0MjB9.abcDEF123-_xyz")).toBeNull();
  });
});
