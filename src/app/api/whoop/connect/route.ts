import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeUrl, isWhoopConfigured } from "@/lib/whoop/client";
import { requireWorkspace } from "@/lib/data/workspace";

export const dynamic = "force-dynamic";

/** Starts the WHOOP OAuth flow for the signed-in user. The state lives in a short httpOnly cookie. */
export async function GET(request: NextRequest) {
  await requireWorkspace();
  if (!isWhoopConfigured()) return NextResponse.redirect(new URL("/health/data?whoop=unconfigured", request.url));
  const state = randomBytes(16).toString("hex");
  const redirectUri = new URL("/api/whoop/callback", request.url).toString();
  const res = NextResponse.redirect(authorizeUrl(redirectUri, state));
  res.cookies.set("whoop_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", maxAge: 600, path: "/api/whoop" });
  return res;
}
