import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Attachment, Note, SocialPostWithRefs } from "@/lib/types";

export const SOCIAL_SELECT = "*, project:projects(id,name), work_area:work_areas(id,name,color), event:events(id,name,start_date)";

export function shapePost(row: SocialPostWithRefs): SocialPostWithRefs {
  return { ...row, assets: Array.isArray(row.assets) ? row.assets : [] };
}

export type SocialFilters = {
  area?: string | null;
  project?: string | null;
  event?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  includePublished?: boolean;
  limit?: number;
};

export async function listSocialPosts(userId: string, f: SocialFilters = {}): Promise<SocialPostWithRefs[]> {
  const supabase = await createClient();
  let q = supabase.from("social_posts").select(SOCIAL_SELECT).eq("user_id", userId);
  if (f.area) q = q.eq("work_area_id", f.area);
  if (f.project) q = q.eq("project_id", f.project);
  if (f.event) q = q.eq("event_id", f.event);
  if (f.status && f.status !== "all") q = q.in("status", f.status.split(","));
  else if (!f.includePublished) q = q.neq("status", "published");
  if (f.from) q = q.gte("publish_date", f.from);
  if (f.to) q = q.lte("publish_date", f.to);
  q = q.order("publish_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(f.limit ?? 500);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as SocialPostWithRefs[]).map(shapePost);
}

export type SocialPostDetail = { post: SocialPostWithRefs; notes: Note[]; attachments: Attachment[] };

export async function getSocialPostDetail(userId: string, id: string): Promise<SocialPostDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("social_posts").select(SOCIAL_SELECT).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [notes, atts] = await Promise.all([
    supabase.from("notes").select("*").eq("social_post_id", id).order("created_at", { ascending: false }),
    supabase.from("attachments").select("*").eq("social_post_id", id).order("created_at", { ascending: false }),
  ]);
  return { post: shapePost(data as SocialPostWithRefs), notes: (notes.data ?? []) as Note[], attachments: (atts.data ?? []) as Attachment[] };
}
