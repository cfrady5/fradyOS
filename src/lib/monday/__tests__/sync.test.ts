import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MondayItem } from "../client";
import type { MondayConnection } from "@/lib/types";

// --- Minimal in-memory stand-in for the subset of supabase-js used by the sync engine ---
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { events: [], monday_sync_runs: [], monday_connections: [], work_areas: [] };
let idCounter = 0;

function makeBuilder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" | "delete" = "select";
  let payload: Row | Row[] | null = null;
  let single = false;
  const b = {
    select() { return b; },
    eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return b; },
    neq(k: string, v: unknown) { filters.push((r) => r[k] !== v); return b; },
    is(k: string, v: unknown) { filters.push((r) => r[k] === v); return b; },
    in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return b; },
    not() { return b; },
    order() { return b; },
    limit() { return b; },
    insert(p: Row | Row[]) { op = "insert"; payload = p; return b; },
    update(p: Row) { op = "update"; payload = p; return b; },
    delete() { op = "delete"; return b; },
    single() { single = true; return b; },
    maybeSingle() { single = true; return b; },
    then(resolve: (v: { data: unknown; error: null | { message: string; code?: string }; count?: number }) => void) {
      const rows = tables[table];
      const match = (r: Row) => filters.every((f) => f(r));
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload!];
        for (const p of list) {
          if (table === "events" && p.monday_item_id && rows.some((r) => r.user_id === p.user_id && r.monday_board_id === p.monday_board_id && r.monday_item_id === p.monday_item_id)) {
            return resolve({ data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } });
          }
          rows.push({ id: `id-${++idCounter}`, sync_flag: "none", review_dismissed_at: null, dates_changed_at: null, previous_start_date: null, previous_end_date: null, work_area_id: null, ...p });
        }
        const inserted = rows.slice(-list.length);
        return resolve({ data: single ? inserted[0] : inserted, error: null });
      }
      if (op === "update") {
        const hit = rows.filter(match);
        for (const r of hit) Object.assign(r, payload);
        return resolve({ data: hit, error: null, count: hit.length });
      }
      if (op === "delete") {
        const keep = rows.filter((r) => !match(r));
        tables[table] = keep;
        return resolve({ data: null, error: null });
      }
      const hit = rows.filter(match);
      return resolve({ data: single ? (hit[0] ?? null) : hit, error: null, count: hit.length });
    },
  };
  return b;
}
const fakeSupabase = { from: (t: string) => makeBuilder(t) };

const items: MondayItem[] = [];
vi.mock("../client", () => ({
  fetchAllItems: vi.fn(async () => items),
  MondayError: class extends Error {},
}));

const { runMondaySync } = await import("../sync");

const connection: MondayConnection = {
  id: "conn", user_id: "u1", board_id: "b1", board_name: "Events", column_map: { name: "__name__", start: "date", status: "status" }, columns_snapshot: [], canceled_labels: ["canceled", "cancelled"],
  auto_sync_enabled: true, webhook_ids: [], last_webhook_at: null, last_sync_started_at: null, last_success_at: null, last_error: null, last_result: null, created_at: "", updated_at: "",
};

function item(id: string, name: string, date: string, status = "Confirmed"): MondayItem {
  return { id, name, url: `https://m/${id}`, state: "active", updated_at: null, group: { id: "g", title: "Fall" }, column_values: [
    { id: "date", type: "date", text: date, value: null, date, time: null },
    { id: "status", type: "status", text: status, value: null, label: status },
  ] };
}

beforeEach(() => {
  tables.events = [];
  tables.monday_sync_runs = [];
  tables.monday_connections = [{ id: "conn", user_id: "u1" }];
  tables.work_areas = [{ id: "wa1", user_id: "u1", name: "ARI", is_archived: false }];
  items.length = 0;
});

describe("Monday sync engine", () => {
  it("imports items once and never duplicates on re-run", async () => {
    items.push(item("1", "Fall Gala", "2026-10-01"), item("2", "Webinar", "2026-11-05"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r1 = await runMondaySync(fakeSupabase as any, "u1", connection, "manual");
    expect(r1).toMatchObject({ items_seen: 2, created: 2, updated: 0, unchanged: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r2 = await runMondaySync(fakeSupabase as any, "u1", connection, "scheduled");
    expect(r2).toMatchObject({ items_seen: 2, created: 0, updated: 0, unchanged: 2 });
    expect(tables.events).toHaveLength(2);
    expect(tables.events[0]).toMatchObject({ source: "monday", monday_board_id: "b1", monday_item_id: "1", name: "Fall Gala", start_date: "2026-10-01", sync_flag: "none" });
    expect(tables.monday_sync_runs.map((r) => r.status)).toEqual(["success", "success"]);
    expect(tables.monday_connections[0].last_error).toBeNull();
  });

  it("records date changes without touching local fields, and flags canceled/removed items", async () => {
    items.push(item("1", "Fall Gala", "2026-10-01"), item("2", "Webinar", "2026-11-05"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runMondaySync(fakeSupabase as any, "u1", connection, "manual");
    // Local work on the event that sync must not overwrite.
    Object.assign(tables.events[0], { local_notes: "my notes", project_id: "p1", work_area_id: "wa-local" });

    items.length = 0;
    items.push(item("1", "Fall Gala (moved)", "2026-10-08", "Canceled"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runMondaySync(fakeSupabase as any, "u1", connection, "manual");
    expect(r).toMatchObject({ items_seen: 1, updated: 1, dates_changed: 1, flagged_canceled: 1, flagged_removed: 1 });

    const gala = tables.events.find((e) => e.monday_item_id === "1")!;
    expect(gala).toMatchObject({ name: "Fall Gala (moved)", start_date: "2026-10-08", previous_start_date: "2026-10-01", sync_flag: "canceled", local_notes: "my notes", project_id: "p1", work_area_id: "wa-local" });
    expect(gala.dates_changed_at).toBeTruthy();

    const webinar = tables.events.find((e) => e.monday_item_id === "2")!;
    expect(webinar).toMatchObject({ sync_flag: "removed", name: "Webinar" });
    expect(tables.events).toHaveLength(2); // nothing deleted
  });

  it("clears flags when an item comes back or is un-canceled, and auto-assigns a matching work area", async () => {
    items.push(item("1", "Fall Gala", "2026-10-01", "Canceled"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runMondaySync(fakeSupabase as any, "u1", connection, "manual");
    expect(tables.events[0].sync_flag).toBe("canceled");
    items.length = 0;
    items.push({ ...item("1", "Fall Gala", "2026-10-01", "Confirmed"), column_values: [...item("1", "x", "2026-10-01").column_values, { id: "prog", type: "dropdown", text: "ari", value: null }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runMondaySync(fakeSupabase as any, "u1", { ...connection, column_map: { ...connection.column_map, program: "prog" } }, "manual");
    expect(tables.events[0]).toMatchObject({ sync_flag: "none", sync_flag_reason: null, work_area_id: "wa1", program: "ari" });
  });

  it("records errors on the connection and run when the mapping is incomplete", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(runMondaySync(fakeSupabase as any, "u1", { ...connection, column_map: {} }, "manual")).rejects.toThrow(/start date/);
    expect(tables.monday_sync_runs[0].status).toBe("error");
    expect(String(tables.monday_connections[0].last_error)).toMatch(/start date/);
  });
});
