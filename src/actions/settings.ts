"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/data/workspace";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";

const schema = z.object({
  display_name: z.string().trim().max(120).nullable().optional(),
  timezone: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone")
    .optional(),
  week_starts_on: z.coerce.number().int().min(0).max(1).optional(),
  reminder_days_before_due: z.coerce.number().int().min(0).max(30).optional(),
  reminder_days_before_social: z.coerce.number().int().min(0).max(30).optional(),
  reminder_days_before_event: z.coerce.number().int().min(0).max(60).optional(),
  email_reminders_enabled: z.boolean().optional(),
});

export async function updateProfile(input: unknown): Promise<ActionResult<undefined>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  try {
    const ws = await requireWorkspace();
    if (parsed.data.email_reminders_enabled && !process.env.RESEND_API_KEY) {
      return fail("Email reminders need an email service. Set RESEND_API_KEY on the server first.");
    }
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").update(parsed.data).eq("id", ws.userId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
