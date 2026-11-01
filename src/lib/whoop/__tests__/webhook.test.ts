import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWhoopSignature } from "../webhook";

describe("verifyWhoopSignature", () => {
  const secret = "s3cret";
  const body = '{"type":"sleep.updated","id":"abc","user_id":1}';
  const ts = String(Date.now());
  const sig = createHmac("sha256", secret).update(`${ts}${body}`).digest("base64");

  it("accepts a fresh, correctly signed body", () => {
    expect(verifyWhoopSignature(body, sig, ts, secret)).toEqual({ ok: true });
  });
  it("rejects tampering, missing headers and stale timestamps", () => {
    expect(verifyWhoopSignature(body + " ", sig, ts, secret).ok).toBe(false);
    expect(verifyWhoopSignature(body, null, ts, secret).ok).toBe(false);
    const old = String(Date.now() - 10 * 60_000);
    const oldSig = createHmac("sha256", secret).update(`${old}${body}`).digest("base64");
    expect(verifyWhoopSignature(body, oldSig, old, secret).ok).toBe(false);
    expect(verifyWhoopSignature(body, sig, ts, "other").ok).toBe(false);
  });
});
