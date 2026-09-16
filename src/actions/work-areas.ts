"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color").default("#6366f1"),
});

export async function createWorkArea(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("work_areas")
      .insert({ user_id: ws.userId, ...parsed.data, sort_order: ws.workAreas.length })
      .select("id")
      .single();
    if (error) return fail(error.code === "23505" ? "A work area with that name already exists" : error.message);
    revalidatePath("/", "layout");
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function updateWorkArea(id: string, input: unknown): Promise<ActionResult<undefined>> {
  const parsed = schema.partial().extend({ is_archived: z.boolean().optional(), sort_order: z.number().int().optional() }).safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("work_areas").update(parsed.data).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.code === "23505" ? "A work area with that name already exists" : error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteWorkArea(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("work_areas").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function reorderWorkAreas(ids: string[]): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    for (let i = 0; i < ids.length; i++) {
      await supabase.from("work_areas").update({ sort_order: i }).eq("id", ids[i]).eq("user_id", ws.userId);
    }
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
