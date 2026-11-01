import { appleAppSiteAssociation } from "@/lib/native/deepLinks";

export const dynamic = "force-dynamic";

export function GET() {
  const body = appleAppSiteAssociation(process.env.APPLE_TEAM_ID);
  if (!body) return new Response("Not configured", { status: 404 });
  return Response.json(body, { headers: { "cache-control": "public, max-age=3600" } });
}
