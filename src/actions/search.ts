"use server";

import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";

export type SearchHit = {
  kind: "project" | "task" | "event" | "social";
  id: string;
  title: string;
  subtitle: string | null;
  date_hint: string | null;
  status: string | null;
};

export async function searchWorkspace(q: string): Promise<ActionResult<SearchHit[]>> {
  const needle = q.trim();
  if (needle.length < 2) return ok([]);
  try {
    await requireWorkspace();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("search_workspace", { q: needle.slice(0, 100), max_results: 40 });
    if (error) return fail(error.message);
    return ok((data ?? []) as SearchHit[]);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
