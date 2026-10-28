import { sites } from "@/data/sites";
import { SectionHeader } from "../SectionHeader";
import { Gallery } from "../Gallery";

export function SelectedWork() {
  const primary = sites.filter((s) => s.group === "primary").length;
  const events = sites.length - primary;
  return (
    <section id="gallery" aria-labelledby="gallery-heading" className="border-b border-hairline">
      <div className="px-6 pt-20 pb-12 md:px-14 md:pt-28 md:pb-16 lg:pt-32">
        <SectionHeader
          id="gallery-heading"
          line1="Work in the wild."
          line2={`${sites.length} live sites.`}
          text={`${primary} websites and ${events} event pages, shown as live previews. Scroll the shelf, then open any of them in a new tab.`}
        />
      </div>
      <div className="border-t border-hairline">
        <Gallery />
      </div>
    </section>
  );
}
