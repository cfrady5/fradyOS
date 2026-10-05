/**
 * In-memory stand-in for the Supabase client, used only when FRADYOS_PREVIEW=1 in development.
 * It implements the PostgREST query-builder subset the app uses (filters, or(), embedded
 * resources, ordering, counts, insert/update/upsert/delete) over seeded demo data so every
 * screen can be rendered and screenshotted without a database or a session.
 */
import { seedTables, PREVIEW_USER } from "./seed";

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "upsert" | "delete";
type Filter = (r: Row) => boolean;

/** Embedded resources: table → relation name → how to resolve it. */
const RELATIONS: Record<string, Record<string, { table: string; fk: string; many: boolean; reverse?: boolean }>> = {
  tasks: {
    project: { table: "projects", fk: "project_id", many: false },
    work_area: { table: "work_areas", fk: "work_area_id", many: false },
    event: { table: "events", fk: "event_id", many: false },
    subtasks: { table: "subtasks", fk: "task_id", many: true, reverse: true },
  },
  projects: {
    work_area: { table: "work_areas", fk: "work_area_id", many: false },
    tasks: { table: "tasks", fk: "project_id", many: true, reverse: true },
  },
  events: {
    work_area: { table: "work_areas", fk: "work_area_id", many: false },
    project: { table: "projects", fk: "project_id", many: false },
    tasks: { table: "tasks", fk: "event_id", many: true, reverse: true },
    social_posts: { table: "social_posts", fk: "event_id", many: true, reverse: true },
  },
  social_posts: {
    project: { table: "projects", fk: "project_id", many: false },
    work_area: { table: "work_areas", fk: "work_area_id", many: false },
    event: { table: "events", fk: "event_id", many: false },
  },
  financial_goals: { project: { table: "projects", fk: "linked_project_id", many: false } },
};

let tables: Record<string, Row[]> | null = null;
let seq = 1000;
function db() {
  if (!tables) tables = seedTables();
  return tables;
}
function rows(table: string): Row[] {
  const t = db();
  if (!t[table]) t[table] = [];
  return t[table];
}

function splitTop(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function opFilter(col: string, op: string, raw: unknown): Filter {
  const val = typeof raw === "string" && raw === "null" ? null : raw;
  switch (op) {
    case "eq":
      return (r) => String(r[col]) === String(val);
    case "neq":
      return (r) => String(r[col]) !== String(val);
    case "gt":
      return (r) => r[col] != null && compare(r[col], val) > 0;
    case "gte":
      return (r) => r[col] != null && compare(r[col], val) >= 0;
    case "lt":
      return (r) => r[col] != null && compare(r[col], val) < 0;
    case "lte":
      return (r) => r[col] != null && compare(r[col], val) <= 0;
    case "is":
      return (r) => (val === null ? r[col] == null : r[col] === val);
    case "in": {
      const list = Array.isArray(val) ? val : String(val).replace(/^\(|\)$/g, "").split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
      return (r) => list.map(String).includes(String(r[col]));
    }
    case "ilike": {
      const re = new RegExp("^" + String(val).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
      return (r) => re.test(String(r[col] ?? ""));
    }
    case "like": {
      const re = new RegExp("^" + String(val).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$");
      return (r) => re.test(String(r[col] ?? ""));
    }
    default:
      return () => true;
  }
}

/** Parses PostgREST logic strings such as `a.gte.x,and(b.is.null,c.lte.y)`. */
function parseLogic(expr: string, mode: "or" | "and"): Filter {
  const parts = splitTop(expr);
  const fns = parts.map((p): Filter => {
    const m = p.match(/^(and|or)\((.*)\)$/);
    if (m) return parseLogic(m[2], m[1] as "or" | "and");
    const seg = p.match(/^([a-z_]+)\.(not\.)?([a-z]+)\.(.*)$/);
    if (!seg) return () => true;
    const f = opFilter(seg[1], seg[3], seg[4]);
    return seg[2] ? (r) => !f(r) : f;
  });
  return mode === "or" ? (r) => fns.some((f) => f(r)) : (r) => fns.every((f) => f(r));
}

function project(table: string, row: Row, select: string): Row {
  if (!select || select.trim() === "*") return { ...row };
  const out: Row = {};
  for (const part of splitTop(select)) {
    if (part === "*") {
      Object.assign(out, row);
      continue;
    }
    const emb = part.match(/^(?:([a-z_]+):)?([a-z_]+)\((.*)\)$/);
    if (emb) {
      const alias = emb[1] ?? emb[2];
      const rel = RELATIONS[table]?.[emb[2]];
      if (!rel) {
        out[alias] = null;
        continue;
      }
      if (rel.reverse) out[alias] = rows(rel.table).filter((x) => x[rel.fk] === row.id).map((x) => project(rel.table, x, emb[3]));
      else {
        const target = row[rel.fk] ? rows(rel.table).find((x) => x.id === row[rel.fk]) : undefined;
        out[alias] = target ? project(rel.table, target, emb[3]) : null;
      }
      continue;
    }
    out[part] = row[part] ?? null;
  }
  return out;
}

class Builder implements PromiseLike<{ data: unknown; error: null | { message: string; code?: string }; count: number | null }> {
  private filters: Filter[] = [];
  private op: Op = "select";
  private selectStr = "*";
  private payload: Row | Row[] | null = null;
  private conflict: string[] = [];
  private orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
  private limitN: number | null = null;
  private wantSingle = false;
  private wantMaybe = false;
  private wantCount = false;
  private head = false;
  constructor(private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") this.selectStr = cols;
    else this.selectStr = cols || "*";
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.head = true;
    return this;
  }
  eq(c: string, v: unknown) { this.filters.push(opFilter(c, "eq", v)); return this; }
  neq(c: string, v: unknown) { this.filters.push(opFilter(c, "neq", v)); return this; }
  gt(c: string, v: unknown) { this.filters.push(opFilter(c, "gt", v)); return this; }
  gte(c: string, v: unknown) { this.filters.push(opFilter(c, "gte", v)); return this; }
  lt(c: string, v: unknown) { this.filters.push(opFilter(c, "lt", v)); return this; }
  lte(c: string, v: unknown) { this.filters.push(opFilter(c, "lte", v)); return this; }
  is(c: string, v: unknown) { this.filters.push(opFilter(c, "is", v)); return this; }
  in(c: string, v: unknown[]) { this.filters.push(opFilter(c, "in", v)); return this; }
  ilike(c: string, v: string) { this.filters.push(opFilter(c, "ilike", v)); return this; }
  like(c: string, v: string) { this.filters.push(opFilter(c, "like", v)); return this; }
  not(c: string, op: string, v: unknown) { const f = opFilter(c, op, v); this.filters.push((r) => !f(r)); return this; }
  or(expr: string) { this.filters.push(parseLogic(expr, "or")); return this; }
  match(obj: Record<string, unknown>) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) { this.orders.push({ col, asc: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst ?? !(opts?.ascending ?? true) }); return this; }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.limitN = to - from + 1; return this; }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
  upsert(p: Row | Row[], opts?: { onConflict?: string }) { this.op = "upsert"; this.payload = p; this.conflict = (opts?.onConflict ?? "id").split(",").map((s) => s.trim()); return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  single() { this.wantSingle = true; return this; }
  maybeSingle() { this.wantMaybe = true; return this; }
  returns() { return this; }

  private run(): { data: unknown; error: null | { message: string; code?: string }; count: number | null } {
    const all = rows(this.table);
    const match = (r: Row) => this.filters.every((f) => f(r));
    const now = new Date().toISOString();
    const finish = (list: Row[]) => {
      const out = list.map((r) => project(this.table, r, this.selectStr));
      if (this.wantSingle || this.wantMaybe) {
        if (this.wantSingle && out.length !== 1) return { data: null, error: { message: out.length ? "Multiple rows" : "Row not found", code: "PGRST116" }, count: null };
        return { data: out[0] ?? null, error: null, count: null };
      }
      return { data: out, error: null, count: out.length };
    };
    if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const written: Row[] = [];
      for (const p of list) {
        const hit = this.op === "upsert" ? all.find((r) => this.conflict.every((k) => r[k] === p[k])) : undefined;
        if (hit) {
          Object.assign(hit, p, { updated_at: now });
          written.push(hit);
        } else {
          const row: Row = { id: `prev-${this.table}-${++seq}`, user_id: PREVIEW_USER.id, created_at: now, updated_at: now, ...p };
          all.push(row);
          written.push(row);
        }
      }
      return finish(written);
    }
    if (this.op === "update") {
      const hit = all.filter(match);
      for (const r of hit) Object.assign(r, this.payload, { updated_at: now });
      return finish(hit);
    }
    if (this.op === "delete") {
      const keep = all.filter((r) => !match(r));
      const removed = all.filter(match);
      db()[this.table] = keep;
      return finish(removed);
    }
    let hit = all.filter(match);
    for (const o of [...this.orders].reverse()) {
      hit = [...hit].sort((a, b) => {
        const av = a[o.col];
        const bv = b[o.col];
        if (av == null && bv == null) return 0;
        if (av == null) return o.nullsFirst ? -1 : 1;
        if (bv == null) return o.nullsFirst ? 1 : -1;
        const c = compare(av, bv);
        return o.asc ? c : -c;
      });
    }
    const total = hit.length;
    if (this.limitN != null) hit = hit.slice(0, this.limitN);
    if (this.head) return { data: null, error: null, count: total };
    const res = finish(hit);
    return { ...res, count: this.wantCount ? total : res.count };
  }

  then<R1 = unknown, R2 = never>(onfulfilled?: ((v: { data: unknown; error: null | { message: string; code?: string }; count: number | null }) => R1 | PromiseLike<R1>) | null, onrejected?: ((e: unknown) => R2 | PromiseLike<R2>) | null): Promise<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export function createPreviewClient() {
  return {
    from: (table: string) => new Builder(table),
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "search_workspace") {
        const q = String(args?.q ?? "").toLowerCase();
        const hits: Row[] = [];
        for (const t of rows("tasks")) if (String(t.title).toLowerCase().includes(q)) hits.push({ kind: "task", id: t.id, title: t.title, subtitle: null, date_hint: t.due_date ?? null, status: t.status });
        for (const p of rows("projects")) if (String(p.name).toLowerCase().includes(q)) hits.push({ kind: "project", id: p.id, title: p.name, subtitle: null, date_hint: p.target_date ?? null, status: p.status });
        for (const e of rows("events")) if (String(e.name).toLowerCase().includes(q)) hits.push({ kind: "event", id: e.id, title: e.name, subtitle: e.location ?? null, date_hint: e.start_date ?? null, status: e.status });
        return { data: hits.slice(0, 40), error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      getClaims: async () => ({ data: { claims: { sub: PREVIEW_USER.id, email: PREVIEW_USER.email } }, error: null }),
      getUser: async () => ({ data: { user: { id: PREVIEW_USER.id, email: PREVIEW_USER.email } }, error: null }),
      signOut: async () => ({ error: null }),
      admin: { getUserById: async () => ({ data: { user: { id: PREVIEW_USER.id, email: PREVIEW_USER.email } }, error: null }) },
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: { message: "Storage is disabled in preview mode" } }),
        remove: async () => ({ data: null, error: null }),
        createSignedUrl: async () => ({ data: null, error: { message: "Storage is disabled in preview mode" } }),
      }),
    },
  };
}

/** Preview is opt-in via FRADYOS_PREVIEW=1 and can never activate on Vercel (VERCEL=1 is always set there). */
export function isPreviewMode() {
  return process.env.FRADYOS_PREVIEW === "1" && !process.env.VERCEL;
}
