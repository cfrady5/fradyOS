"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";

const schema = z
  .object({
    task_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    event_id: z.string().uuid().optional(),
    social_post_id: z.string().uuid().optional(),
    storage_path: z.string().min(1).max(1000),
    file_name: z.string().min(1).max(300),
    mime_type: z.string().max(200).nullable().optional(),
    size_bytes: z.number().int().min(0).nullable().optional(),
  })
  .refine((p) => [p.task_id, p.project_id, p.event_id, p.social_post_id].filter(Boolean).length === 1, "Exactly one parent");

/** Records an attachment after the browser uploaded the file to Supabase Storage. */
export async function registerAttachment(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Invalid attachment");
  try {
    const ws = await requireWorkspace();
    if (!parsed.data.storage_path.startsWith(`${ws.userId}/`)) return fail("Invalid storage path");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("attachments")
      .insert({ user_id: ws.userId, ...parsed.data })
      .select("id")
      .single();
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function getAttachmentUrl(id: string): Promise<ActionResult<{ url: string }>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: att } = await supabase.from("attachments").select("storage_path").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!att) return fail("Attachment not found");
    const { data, error } = await supabase.storage.from("attachments").createSignedUrl(att.storage_path, 60 * 10);
    if (error || !data) return fail(error?.message ?? "Could not create link");
    return ok({ url: data.signedUrl });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function deleteAttachment(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { data: att } = await supabase.from("attachments").select("storage_path").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!att) return fail("Attachment not found");
    await supabase.storage.from("attachments").remove([att.storage_path]);
    const { error } = await supabase.from("attachments").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
