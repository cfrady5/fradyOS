"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { getSocialPostDetail, type SocialPostDetail } from "@/lib/data/social";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import { socialPostInputSchema, firstZodMessage, zodFieldErrors } from "@/lib/validation";
import type { MondayConnection, SocialPost } from "@/lib/types";
import { isMondayConfigured } from "@/lib/monday/client";
import { pushSocialPostToMonday } from "@/lib/monday/social-sync";

export async function createSocialPost(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = socialPostInputSchema.safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const v = parsed.data;
    const supabase = await createClient();
    const status = v.status ?? "idea";
    const { data, error } = await supabase
      .from("social_posts")
      .insert({ user_id: ws.userId, ...v, status, assets: v.assets ?? [], published_at: status === "published" ? new Date().toISOString() : null })
      .select("id")
      .single();
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok({ id: data.id as string });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function updateSocialPost(id: string, input: unknown): Promise<ActionResult<{ id: string; monday_warning?: string }>> {
  try {
    const ws = await requireWorkspace();
    const parsed = socialPostInputSchema.partial().safeParse(input);
    if (!parsed.success) return fail(firstZodMessage(parsed.error), zodFieldErrors(parsed.error));
    const v = parsed.data;
    const supabase = await createClient();
    const { data: existing } = await supabase.from("social_posts").select("*").eq("id", id).eq("user_id", ws.userId).maybeSingle();
    if (!existing) return fail("Post not found");
    const prev = existing as SocialPost;
    const update: Record<string, unknown> = { ...v };
    if (v.status && v.status !== prev.status) {
      if (v.status === "published") update.published_at = new Date().toISOString();
      else if (prev.status === "published") update.published_at = null;
    }
    // Manual date edits on template-derived posts opt out of automatic proposals.
    if (prev.template_item_id) {
      const dateKeys: (keyof SocialPost)[] = ["publish_date", "draft_due_date", "approval_due_date"];
      if (dateKeys.some((k) => v[k as keyof typeof v] !== undefined && v[k as keyof typeof v] !== prev[k])) update.date_overridden = true;
    }
    const { error } = await supabase.from("social_posts").update(update).eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);

    // Linked to the Monday social board: push the mapped fields so the board stays current.
    let monday_warning: string | undefined;
    if (prev.monday_item_id && isMondayConfigured()) {
      const { data: conn } = await supabase.from("monday_connections").select("*").eq("user_id", ws.userId).eq("purpose", "social").maybeSingle();
      if (conn && (conn as MondayConnection).board_id === prev.monday_board_id) {
        try {
          await pushSocialPostToMonday(supabase, ws.userId, conn as MondayConnection, id);
        } catch (e) {
          monday_warning = `Saved here, but Monday.com was not updated: ${errorMessage(e)}`;
        }
      }
    }
    revalidatePath("/", "layout");
    return ok({ id, monday_warning });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function markPostPublished(id: string, publishedUrl?: string | null): Promise<ActionResult<{ id: string }>> {
  const patch: Record<string, unknown> = { status: "published" };
  if (publishedUrl) patch.published_url = publishedUrl;
  return updateSocialPost(id, patch);
}

export async function deleteSocialPost(id: string): Promise<ActionResult<undefined>> {
  try {
    const ws = await requireWorkspace();
    const supabase = await createClient();
    const { error } = await supabase.from("social_posts").delete().eq("id", id).eq("user_id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function loadSocialPost(id: string): Promise<ActionResult<SocialPostDetail>> {
  try {
    const ws = await requireWorkspace();
    const d = await getSocialPostDetail(ws.userId, id);
    if (!d) return fail("Post not found");
    return ok(d);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
