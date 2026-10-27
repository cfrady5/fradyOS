import type { Metadata } from "next";
import { Placeholder } from "@/components/Placeholder";

export const metadata: Metadata = { title: "Work" };

export default function Page() {
  return <Placeholder index="01" title="Work" />;
}
