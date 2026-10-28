import type { Metadata } from "next";
import { Hero } from "@/components/site/sections/Hero";
import { Services } from "@/components/site/sections/Services";
import { HowIWork } from "@/components/site/sections/HowIWork";
import { SelectedWork } from "@/components/site/sections/SelectedWork";
import { StartSomething } from "@/components/site/sections/StartSomething";
import { Footer } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: { absolute: "FRADY · Caleb Frady" },
  description: "Caleb Frady. Rooted in nature, engineered in code. Content, systems, ventures and motion.",
};

export default function HomePage() {
  return (
    <main className="mx-4 min-h-screen border-x border-hairline md:mx-12">
        <Hero />
        <Services />
        <HowIWork />
        <SelectedWork />
        <StartSomething />
        <Footer />
    </main>
  );
}
