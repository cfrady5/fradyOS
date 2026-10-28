import type { Metadata } from "next";
import { LabClient } from "@/components/particle-engine/LabClient";

export const metadata: Metadata = {
  title: { absolute: "Particle lab · FRADY" },
  description: "Type an idea and fifty thousand particles assemble into it. A GPU particle engine by Caleb Frady.",
};

export default function LabPage() {
  return <LabClient />;
}
