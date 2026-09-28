import { beforeEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { _clearKeyCache, verifyPlaidWebhook, type Jwk } from "../webhook";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string };
const KEY: Jwk = { ...jwk, kid: "kid-1", alg: "ES256" };

function makeJwt(body: string, opts: { iat?: number; kid?: string; alg?: string; tamperSig?: boolean } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: opts.alg ?? "ES256", kid: opts.kid ?? "kid-1", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: opts.iat ?? Math.floor(Date.now() / 1000), request_body_sha256: createHash("sha256").update(body, "utf8").digest("hex") })).toString("base64url");
  let sig = sign("sha256", Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  if (opts.tamperSig) sig = Buffer.from(sig.map((b, i) => (i === 3 ? b ^ 0xff : b)));
  return `${header}.${payload}.${sig.toString("base64url")}`;
}

const fetchKey = async (kid: string) => {
  if (kid !== "kid-1") throw new Error("unknown kid");
  return KEY;
};

describe("Plaid webhook verification", () => {
  beforeEach(() => _clearKeyCache());
  it("accepts a correctly signed body", async () => {
    const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "it" });
    expect(await verifyPlaidWebhook(body, makeJwt(body), { fetchKey })).toEqual({ ok: true });
  });
  it("rejects a modified body, a bad signature, a stale token, a missing header and a wrong algorithm", async () => {
    const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" });
    expect((await verifyPlaidWebhook(body + " ", makeJwt(body), { fetchKey })).ok).toBe(false);
    expect((await verifyPlaidWebhook(body, makeJwt(body, { tamperSig: true }), { fetchKey })).ok).toBe(false);
    expect((await verifyPlaidWebhook(body, makeJwt(body, { iat: Math.floor(Date.now() / 1000) - 600 }), { fetchKey })).ok).toBe(false);
    expect((await verifyPlaidWebhook(body, null, { fetchKey })).ok).toBe(false);
    expect((await verifyPlaidWebhook(body, makeJwt(body, { alg: "HS256" }), { fetchKey })).ok).toBe(false);
    expect((await verifyPlaidWebhook(body, makeJwt(body, { kid: "other" }), { fetchKey })).ok).toBe(false);
  });
});
