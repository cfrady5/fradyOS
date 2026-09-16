export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = undefined>(error: string, fieldErrors?: Record<string, string>): ActionResult<T> {
  return { ok: false, error, fieldErrors };
}

/** Normalizes thrown errors (Supabase, zod, unknown) into a readable message. */
export function errorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (!e) return fallback;
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || fallback;
  if (typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return fallback;
}
