import type { Metadata } from "next";
import { Placeholder } from "@/components/site/Placeholder";

export const metadata: Metadata = { title: { absolute: "About · FRADY" } };

export default function Page() {
  return <Placeholder index="04" title="About" />;
}
