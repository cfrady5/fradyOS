import { Nav } from "@/components/Nav";
import { Hero } from "@/components/sections/Hero";
import { Strip } from "@/components/Strip";
import { HowIWork } from "@/components/sections/HowIWork";
import { SelectedWork } from "@/components/sections/SelectedWork";
import { StartSomething } from "@/components/sections/StartSomething";
import { Footer } from "@/components/Footer";

export default function HomePage() {
  return (
    <>
      <Nav />
      <main className="mx-4 min-h-screen border-x border-hairline md:mx-12">
        <Hero />
        <Strip />
        <HowIWork />
        <SelectedWork />
        <StartSomething />
        <Footer />
      </main>
    </>
  );
}
