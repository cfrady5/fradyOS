import "server-only";

/**
 * Minimal Monday.com GraphQL client (API version 2026-01).
 * The token is read from MONDAY_API_TOKEN on the server and never sent to the browser.
 */
export const MONDAY_ENDPOINT = "https://api.monday.com/v2";
export const MONDAY_API_VERSION = "2026-01";

/** A real personal API token is a long ASCII string; placeholder text (spaces, arrows, angle brackets) is not. */
export function mondayTokenProblem(token: string | undefined): string | null {
  const t = token?.trim() ?? "";
  if (!t) return "MONDAY_API_TOKEN is not set on the server.";
  if (/[^\x21-\x7e]/.test(t) || /[<>]/.test(t)) return "MONDAY_API_TOKEN contains spaces or non-ASCII characters, so it is probably placeholder text. Paste only the token from monday.com → your avatar → Developers → My access tokens.";
  if (t.length < 20) return "MONDAY_API_TOKEN is too short to be a real token.";
  return null;
}

export function isMondayConfigured() {
  return mondayTokenProblem(process.env.MONDAY_API_TOKEN) === null;
}

export class MondayError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "MondayError";
    this.status = status;
  }
}

type GraphQLResponse<T> = { data?: T; errors?: { message: string; extensions?: Record<string, unknown> }[]; error_message?: string; error_code?: string };

export async function mondayQuery<T>(query: string, variables: Record<string, unknown> = {}, attempt = 0): Promise<T> {
  const problem = mondayTokenProblem(process.env.MONDAY_API_TOKEN);
  if (problem) throw new MondayError(`Monday.com is not connected: ${problem}`);
  const token = process.env.MONDAY_API_TOKEN!.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let res: Response;
  try {
    res = await fetch(MONDAY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": MONDAY_API_VERSION },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error && e.name === "AbortError" ? "Monday.com request timed out" : `Could not reach Monday.com: ${e instanceof Error ? e.message : "network error"}`;
    throw new MondayError(msg);
  }
  clearTimeout(timer);

  if (res.status === 429 && attempt < 2) {
    const retryAfter = Number(res.headers.get("retry-after")) || 5;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 20) * 1000));
    return mondayQuery<T>(query, variables, attempt + 1);
  }
  if (res.status === 401 || res.status === 403) throw new MondayError("Monday.com rejected the API token (unauthorized). Check MONDAY_API_TOKEN.", res.status);

  let json: GraphQLResponse<T>;
  try {
    json = (await res.json()) as GraphQLResponse<T>;
  } catch {
    throw new MondayError(`Monday.com returned an unreadable response (HTTP ${res.status})`, res.status);
  }
  if (json.error_message) throw new MondayError(`Monday.com error: ${json.error_message}`, res.status);
  if (json.errors?.length) throw new MondayError(`Monday.com error: ${json.errors.map((e) => e.message).join("; ")}`, res.status);
  if (!res.ok) throw new MondayError(`Monday.com request failed (HTTP ${res.status})`, res.status);
  if (!json.data) throw new MondayError("Monday.com returned no data");
  return json.data;
}

export type MondayMe = { name: string; email: string; account: { name: string; slug: string } | null };
export type MondayBoardSummary = { id: string; name: string; state: string; items_count: number | null; workspace: { name: string } | null; board_kind: string };
export type MondayColumn = { id: string; title: string; type: string; settings_str: string | null; archived: boolean };
export type MondayBoardSchema = { id: string; name: string; url: string; columns: MondayColumn[]; groups: { id: string; title: string }[] };

export async function fetchMe(): Promise<MondayMe> {
  const data = await mondayQuery<{ me: MondayMe }>(`query { me { name email account { name slug } } }`);
  return data.me;
}

export async function listBoards(): Promise<MondayBoardSummary[]> {
  const data = await mondayQuery<{ boards: (MondayBoardSummary | null)[] }>(
    `query { boards(limit: 200, order_by: used_at, state: active) { id name state items_count board_kind workspace { name } } }`,
  );
  return (data.boards ?? []).filter((b): b is MondayBoardSummary => Boolean(b));
}

export async function fetchBoardSchema(boardId: string): Promise<MondayBoardSchema | null> {
  const data = await mondayQuery<{ boards: (MondayBoardSchema | null)[] }>(
    `query ($ids: [ID!]) { boards(ids: $ids) { id name url columns { id title type settings_str archived } groups { id title } } }`,
    { ids: [boardId] },
  );
  return data.boards?.[0] ?? null;
}

export type MondayColumnValue = {
  id: string;
  type: string;
  text: string | null;
  value: string | null;
  date?: string | null;
  time?: string | null;
  from?: string | null;
  to?: string | null;
  label?: string | null;
  is_done?: boolean | null;
  url?: string | null;
  url_text?: string | null;
  address?: string | null;
  linked_item_ids?: string[] | null;
  display_value?: string | null;
};

export type MondayItem = {
  id: string;
  name: string;
  url: string;
  state: string | null;
  updated_at: string | null;
  group: { id: string; title: string } | null;
  column_values: MondayColumnValue[];
};

const ITEM_FIELDS = `
  id name url state updated_at group { id title }
  column_values(ids: $columnIds) {
    id type text value
    ... on DateValue { date time }
    ... on TimelineValue { from to }
    ... on StatusValue { label is_done }
    ... on LinkValue { url url_text }
    ... on LocationValue { address }
    ... on BoardRelationValue { linked_item_ids display_value }
  }
`;

/** Pages through every active item on the board. */
export async function fetchAllItems(boardId: string, columnIds: string[], onPage?: (count: number) => void): Promise<MondayItem[]> {
  const items: MondayItem[] = [];
  const first = await mondayQuery<{ boards: ({ items_page: { cursor: string | null; items: MondayItem[] } } | null)[] }>(
    `query ($ids: [ID!], $columnIds: [String!]) { boards(ids: $ids) { items_page(limit: 100) { cursor items { ${ITEM_FIELDS} } } } }`,
    { ids: [boardId], columnIds },
  );
  const page = first.boards?.[0]?.items_page;
  if (!page) throw new MondayError("Board not found or not accessible with this token");
  items.push(...page.items);
  onPage?.(items.length);
  let cursor = page.cursor;
  let guard = 0;
  while (cursor && guard++ < 200) {
    const next = await mondayQuery<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(
      `query ($cursor: String!, $columnIds: [String!]) { next_items_page(cursor: $cursor, limit: 100) { cursor items { ${ITEM_FIELDS} } } }`,
      { cursor, columnIds },
    );
    items.push(...next.next_items_page.items);
    onPage?.(items.length);
    cursor = next.next_items_page.cursor;
  }
  return items;
}

/** Creates an item on a board. column_values keys are column ids in Monday's per-type JSON format. */
export async function createItem(boardId: string, groupId: string | null, name: string, columnValues: Record<string, unknown>): Promise<{ id: string; url: string }> {
  const data = await mondayQuery<{ create_item: { id: string; url: string } | null }>(
    `mutation ($board: ID!, $group: String, $name: String!, $values: JSON) {
      create_item(board_id: $board, group_id: $group, item_name: $name, column_values: $values, create_labels_if_missing: true) { id url }
    }`,
    { board: boardId, group: groupId, name: name.slice(0, 255), values: JSON.stringify(columnValues) },
  );
  if (!data.create_item) throw new MondayError("Monday.com did not return the created item");
  return data.create_item;
}

/** Updates several columns (and optionally the name via the "name" key) on an existing item. */
export async function changeColumnValues(boardId: string, itemId: string, columnValues: Record<string, unknown>): Promise<void> {
  await mondayQuery<{ change_multiple_column_values: { id: string } | null }>(
    `mutation ($board: ID!, $item: ID!, $values: JSON!) {
      change_multiple_column_values(board_id: $board, item_id: $item, column_values: $values, create_labels_if_missing: true) { id }
    }`,
    { board: boardId, item: itemId, values: JSON.stringify(columnValues) },
  );
}
