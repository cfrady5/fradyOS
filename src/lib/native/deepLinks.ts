import "server-only";

/**
 * Verification files that let the iOS and Android apps claim https://<site>/auth/* links,
 * so magic-link emails open inside the native shell instead of the system browser.
 *
 * Both are driven by environment variables so the repo never hard-codes signing identities:
 * - APPLE_TEAM_ID: the 10-character Team ID from the Apple Developer account.
 * - ANDROID_SHA256_CERT_FINGERPRINTS: comma-separated SHA-256 fingerprints of the Play signing keys.
 */
export const NATIVE_APP_ID = "com.frady.os";

export function appleAppSiteAssociation(teamId: string | undefined) {
  const id = (teamId ?? "").trim();
  if (!/^[A-Z0-9]{10}$/.test(id)) return null;
  return {
    applinks: {
      details: [{ appIDs: [`${id}.${NATIVE_APP_ID}`], components: [{ "/": "/auth/*" }] }],
    },
    webcredentials: { apps: [`${id}.${NATIVE_APP_ID}`] },
  };
}

export function androidAssetLinks(fingerprints: string | undefined) {
  const list = (fingerprints ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (list.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: NATIVE_APP_ID, sha256_cert_fingerprints: list },
    },
  ];
}
