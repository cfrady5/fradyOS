import type { Metadata } from "next";
import { Placeholder } from "@/components/site/Placeholder";

export const metadata: Metadata = { title: { absolute: "Ventures · FRADY" } };

export default function Page() {
  return <Placeholder index="02" title="Ventures" />;
}
