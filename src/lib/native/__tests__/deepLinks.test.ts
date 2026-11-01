import { describe, expect, it } from "vitest";
import { androidAssetLinks, appleAppSiteAssociation } from "../deepLinks";

describe("deep link verification files", () => {
  it("builds the Apple association only for a valid team id", () => {
    expect(appleAppSiteAssociation(undefined)).toBeNull();
    expect(appleAppSiteAssociation("short")).toBeNull();
    const body = appleAppSiteAssociation(" ABCDE12345 ");
    expect(body?.applinks.details[0].appIDs).toEqual(["ABCDE12345.com.frady.os"]);
    expect(body?.applinks.details[0].components).toEqual([{ "/": "/auth/*" }]);
  });

  it("accepts comma-separated Android fingerprints and drops malformed ones", () => {
    const fp = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, "0")).join(":");
    expect(androidAssetLinks(undefined)).toBeNull();
    expect(androidAssetLinks("nope")).toBeNull();
    const body = androidAssetLinks(`${fp}, bad`);
    expect(body?.[0].target.package_name).toBe("com.frady.os");
    expect(body?.[0].target.sha256_cert_fingerprints).toEqual([fp.toUpperCase()]);
  });
});
