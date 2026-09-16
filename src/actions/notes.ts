"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";

export type NoteParent = { task_id?: string; project_id?: string; event_id?: string; social_post_id?: string };

const parentSchema = z
  .object({
    task_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    event_id: z.string().uuid().optional(),
    social_post_id: z.string().uuid().optional(),
  })
  .refine((p) => Object.values(p).filter(Boolean).length === 1, "Exactly one parent is required");

export async function addNote(parent: NoteParent, body: string): Promise<ActionResult<{ id: string }>> {
  const p = parentSchema.safeParse(parent);
  if (!p.success) return fail("Invalid note target");
  const text = body.trim();
  if (!text) return fail("Write something first");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("notes")
      .insert({ user_id: ws.userId, ...p.data, body: text.slice(0, 20000) })
      .select("id")
      .single();
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function updateNote(id: string, body: string): Promise<ActionResult<undefined>> {
  const text = body.trim();
  if (!text) return fail("Note cannot be empty");
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("notes").update({ body: text.slice(0, 20000) }).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteNote(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("notes").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
