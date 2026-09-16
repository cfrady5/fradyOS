import "server-only";

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.REMINDER_FROM_EMAIL);
}

/** Sends a plain email through Resend's REST API. Returns the provider id or throws. */
export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;
  if (!key || !from) throw new Error("Email is not configured (RESEND_API_KEY / REMINDER_FROM_EMAIL)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Email send failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string };
  return json.id ?? "sent";
}
