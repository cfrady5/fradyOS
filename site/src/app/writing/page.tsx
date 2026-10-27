import type { Metadata } from "next";
import { Placeholder } from "@/components/Placeholder";

export const metadata: Metadata = { title: "Writing" };

export default function Page() {
  return <Placeholder index="03" title="Writing" />;
}
