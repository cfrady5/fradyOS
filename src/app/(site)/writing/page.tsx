import type { Metadata } from "next";
import { Placeholder } from "@/components/site/Placeholder";

export const metadata: Metadata = { title: { absolute: "Writing · FRADY" } };

export default function Page() {
  return <Placeholder index="03" title="Writing" />;
}
