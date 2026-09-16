import { describe, expect, it } from "vitest";
import { isPublicPath } from "../proxy";

describe("proxy public paths", () => {
  it("lets auth pages and secret-protected machine endpoints through without a session", () => {
    for (const p of ["/login", "/setup", "/auth/confirm", "/auth/callback", "/api/cron/monday-sync", "/api/cron/reminders", "/api/webhooks/monday", "/api/health"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });
  it("protects everything else", () => {
    for (const p of ["/", "/tasks", "/projects/abc", "/settings", "/api/export", "/loginx", "/api/webhooksx"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});
