import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken, keySource } from "../crypto";

const saved = { key: process.env.PLAID_TOKEN_ENCRYPTION_KEY, cron: process.env.CRON_SECRET };
beforeEach(() => {
  delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  if (saved.key) process.env.PLAID_TOKEN_ENCRYPTION_KEY = saved.key;
  if (saved.cron) process.env.CRON_SECRET = saved.cron;
});

describe("token encryption", () => {
  it("round-trips with a hex key and never stores the plaintext", () => {
    process.env.PLAID_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
    const enc = encryptToken("access-sandbox-123");
    expect(enc.startsWith("v1.")).toBe(true);
    expect(enc).not.toContain("access-sandbox");
    expect(decryptToken(enc)).toBe("access-sandbox-123");
    expect(keySource()).toBe("env");
    expect(encryptToken("x")).not.toBe(encryptToken("x")); // fresh IV each time
  });
  it("falls back to a key derived from CRON_SECRET and reports it", () => {
    process.env.CRON_SECRET = "a-long-cron-secret-value";
    expect(keySource()).toBe("derived");
    expect(decryptToken(encryptToken("tok"))).toBe("tok");
  });
  it("fails clearly when the key changed", () => {
    process.env.PLAID_TOKEN_ENCRYPTION_KEY = "b".repeat(64);
    const enc = encryptToken("tok");
    process.env.PLAID_TOKEN_ENCRYPTION_KEY = "c".repeat(64);
    expect(() => decryptToken(enc)).toThrow(/encryption key/);
  });
  it("refuses to run with no key at all", () => {
    expect(keySource()).toBe("none");
    expect(() => encryptToken("tok")).toThrow(/PLAID_TOKEN_ENCRYPTION_KEY/);
  });
});
