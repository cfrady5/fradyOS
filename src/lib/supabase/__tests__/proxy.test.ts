import { describe, expect, it } from "vitest";
import { isPublicPath } from "../proxy";

describe("proxy public paths", () => {
  it("lets the public site, auth pages and secret-protected machine endpoints through without a session", () => {
    for (const p of ["/", "/lab", "/api/lab/interpret", "/login", "/setup", "/auth/confirm", "/auth/callback", "/api/cron/monday-sync", "/api/cron/reminders", "/api/webhooks/monday", "/api/health", "/.well-known/assetlinks.json", "/.well-known/apple-app-site-association"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });
  it("protects everything else", () => {
    for (const p of ["/today", "/tasks", "/projects/abc", "/settings", "/finances", "/health", "/health/data", "/api/export", "/loginx", "/work", "/api/webhooksx"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});
