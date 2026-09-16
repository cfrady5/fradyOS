import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile, WorkArea } from "@/lib/types";
import { DEFAULT_TIMEZONE, todayIn } from "@/lib/dates";

export type Workspace = {
  userId: string;
  email: string | null;
  profile: Profile;
  workAreas: WorkArea[];
  today: string;
  timezone: string;
};

/**
 * Loads the signed-in user's workspace, bootstrapping defaults on first visit.
 * Cached per request so layouts and pages share one lookup.
 */
export const getWorkspace = cache(async (): Promise<Workspace | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const email = (claims?.claims?.email as string | undefined) ?? null;

  let { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!profile) {
    await supabase.rpc("ensure_workspace");
    const res = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    profile = res.data;
  }
  if (!profile) return null;

  const { data: areas } = await supabase
    .from("work_areas")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const timezone = (profile as Profile).timezone || DEFAULT_TIMEZONE;
  return {
    userId,
    email,
    profile: profile as Profile,
    workAreas: (areas ?? []) as WorkArea[],
    today: todayIn(timezone),
    timezone,
  };
});

export async function requireWorkspace(): Promise<Workspace> {
  const ws = await getWorkspace();
  if (!ws) throw new Error("Not authenticated");
  return ws;
}
