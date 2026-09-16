import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Guards against writing columns that the migrations never created (the class of bug that
 * "Could not find the 'x' column of 'events' in the schema cache" reports at runtime).
 */
function columnsOf(table: string): Set<string> {
  const dir = path.resolve(__dirname, "../../../../supabase/migrations");
  const sql = readdirSync(dir).sort().map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
  const cols = new Set<string>();
  const create = sql.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, "i"));
  if (create) {
    for (const line of create[1].split("\n")) {
      const m = line.match(/^\s{2}([a-z_]+)\s+(uuid|text|date|time|timestamptz|jsonb|boolean|integer|smallint|bigint|double precision|text\[\])/);
      if (m) cols.add(m[1]);
    }
  }
  for (const m of sql.matchAll(new RegExp(`alter table public\\.${table} add column if not exists ([a-z_]+)`, "gi"))) cols.add(m[1]);
  return cols;
}

describe("sync engine writes only real columns", () => {
  it("every events column written by the Monday sync exists in the migrations", () => {
    const src = readFileSync(path.resolve(__dirname, "../sync.ts"), "utf8");
    const cols = columnsOf("events");
    expect(cols.size).toBeGreaterThan(20);
    const written = new Set<string>();
    // Object-literal keys inside insert({...}) and update[...] assignments.
    for (const m of src.matchAll(/^\s{10}([a-z_]+): /gm)) written.add(m[1]);
    for (const m of src.matchAll(/update\.([a-z_]+) =/g)) written.add(m[1]);
    for (const m of src.matchAll(/\.update\(\{ ([^}]+) \}\)/g)) for (const k of m[1].matchAll(/([a-z_]+):/g)) written.add(k[1]);
    for (const name of ["name", "start_date", "end_date", "start_time", "location", "program", "owner", "status", "website_url", "notes"]) written.add(name);
    const missing = [...written].filter((c) => !cols.has(c));
    expect(missing, `columns written by sync.ts but absent from migrations: ${missing.join(", ")}`).toEqual([]);
  });
});
