"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { projectInputSchema, firstZodMessage, zodFieldErrors } from "@/lib/validation";
import type { Project } from "@/lib/types";

export async function createProject(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = projectInputSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const supabase = await createClient();
    const v = parsed.data;
    const status = v.status ?? "planned";
    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: ws.userId, ...v, status, priority: v.priority ?? "normal", links: v.links ?? [], completed_at: status === "completed" ? new Date().toISOString() : null })
      .select("id")
      .single();
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function updateProject(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = projectInputSchema.partial().safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const supabase = await createClient();
    const { data: existing } = await supabase.from("projects").select("status,completed_at").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Project not found");
    const prev = existing as Pick<Project, "status" | "completed_at">;
    const update: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.status && parsed.data.status !== prev.status) {
      update.completed_at = parsed.data.status === "completed" ? new Date().toISOString() : null;
    }
    const { error } = await supabase.from("projects").update(update).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteProject(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("projects").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
