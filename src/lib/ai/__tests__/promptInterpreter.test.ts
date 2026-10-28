import { describe, expect, it } from "vitest";
import { interpretDeterministic } from "../rules";
import { InterpretationSchema, normalizePrompt } from "../schema";

describe("interpretDeterministic", () => {
  it("renders words, initials and numbers as text", () => {
    expect(interpretDeterministic("The word FRADY")).toMatchObject({ method: "text", text: "FRADY", category: "text" });
    expect(interpretDeterministic("FRADY")).toMatchObject({ method: "text", text: "FRADY" });
    expect(interpretDeterministic('"hello world"')).toMatchObject({ method: "text", text: "hello world" });
    expect(interpretDeterministic("2026")).toMatchObject({ method: "text", text: "2026" });
    expect(interpretDeterministic("initials C.F.")).toMatchObject({ method: "text", text: "C.F." });
  });

  it("maps mathematical forms and well-known objects to procedural geometry", () => {
    expect(interpretDeterministic("A spiral galaxy")).toMatchObject({ method: "geometry", geometry: "galaxy", depth: "volume" });
    expect(interpretDeterministic("A basketball")).toMatchObject({ method: "geometry", geometry: "basketball", category: "object" });
    expect(interpretDeterministic("a black hole")).toMatchObject({ geometry: "blackhole" });
    expect(interpretDeterministic("A blooming rose")).toMatchObject({ geometry: "rose", palette: "lichen" });
    expect(interpretDeterministic("a sphere")).toMatchObject({ geometry: "sphere", category: "geometry" });
  });

  it("sends everything else to image generation, scenes as concepts", () => {
    expect(interpretDeterministic("A wolf howling at the moon")).toMatchObject({ method: "image", category: "concept" });
    expect(interpretDeterministic("A dragon breathing fire")).toMatchObject({ method: "image", category: "concept", palette: "oak" });
    expect(interpretDeterministic("A human face")).toMatchObject({ method: "image", category: "object", subject: "human face" });
  });

  it("always produces a schema-valid interpretation", () => {
    for (const p of ["x", "A", "???", "the", "a very long description of a castle on a hill under a stormy sky with lightning"]) {
      expect(InterpretationSchema.safeParse(interpretDeterministic(p)).success, p).toBe(true);
    }
  });
});

describe("normalizePrompt", () => {
  it("cleans and bounds input", () => {
    expect(normalizePrompt("  a   galaxy \n")).toBe("a galaxy");
    expect(normalizePrompt("")).toBeNull();
    expect(normalizePrompt(42)).toBeNull();
    expect(normalizePrompt("x".repeat(200))?.length).toBe(80);
  });
});
