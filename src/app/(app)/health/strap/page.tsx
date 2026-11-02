import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { getStrapData } from "@/lib/data/strap";
import { StrapView } from "./strap-view";

export const metadata: Metadata = { title: "Strap" };

export default async function StrapPage() {
  const ws = await requireWorkspace();
  const data = await getStrapData(ws.userId, ws.today, ws.timezone);
  return <StrapView data={data} today={ws.today} />;
}
