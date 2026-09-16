import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => false }));
vi.mock("@/lib/monday/client", () => ({ isMondayConfigured: () => false }));
vi.mock("@/lib/monday/sync", () => ({ runMondaySync: vi.fn() }));

const { POST } = await import("../route");

function post(url: string, body: unknown) {
  return POST(new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
}

describe("Monday webhook endpoint", () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, MONDAY_WEBHOOK_SECRET: "0123456789abcdef0123456789abcdef" };
  });
  afterEach(() => {
    process.env = env;
  });

  it("refuses to run without a configured secret", async () => {
    delete process.env.MONDAY_WEBHOOK_SECRET;
    const res = await post("https://frady-os.vercel.app/api/webhooks/monday?token=x", { challenge: "abc" });
    expect(res.status).toBe(500);
  });

  it("rejects a missing or wrong token", async () => {
    expect((await post("https://frady-os.vercel.app/api/webhooks/monday", { challenge: "abc" })).status).toBe(401);
    expect((await post("https://frady-os.vercel.app/api/webhooks/monday?token=wrong", { challenge: "abc" })).status).toBe(401);
  });

  it("echoes Monday's challenge with the correct token", async () => {
    const res = await post("https://frady-os.vercel.app/api/webhooks/monday?token=0123456789abcdef0123456789abcdef", { challenge: "abc123" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "abc123" });
  });

  it("ignores events when the server is not configured for syncing", async () => {
    const res = await post("https://frady-os.vercel.app/api/webhooks/monday?token=0123456789abcdef0123456789abcdef", { event: { type: "change_column_value", boardId: 123 } });
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe(true);
  });

  it("rejects malformed bodies", async () => {
    const res = await POST(new NextRequest("https://frady-os.vercel.app/api/webhooks/monday?token=0123456789abcdef0123456789abcdef", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });
});
