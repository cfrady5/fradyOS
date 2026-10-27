import type { Metadata } from "next";
import { Placeholder } from "@/components/site/Placeholder";

export const metadata: Metadata = { title: { absolute: "Work · FRADY" } };

export default function Page() {
  return <Placeholder index="01" title="Work" />;
}
