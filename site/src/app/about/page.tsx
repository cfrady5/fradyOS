import type { Metadata } from "next";
import { Placeholder } from "@/components/Placeholder";

export const metadata: Metadata = { title: "About" };

export default function Page() {
  return <Placeholder index="04" title="About" />;
}
