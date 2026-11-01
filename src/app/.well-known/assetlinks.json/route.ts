import { androidAssetLinks } from "@/lib/native/deepLinks";

export const dynamic = "force-dynamic";

export function GET() {
  const body = androidAssetLinks(process.env.ANDROID_SHA256_CERT_FINGERPRINTS);
  if (!body) return new Response("Not configured", { status: 404 });
  return Response.json(body, { headers: { "cache-control": "public, max-age=3600" } });
}
