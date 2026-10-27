import { sites } from "@/data/sites";
import { SectionLabel } from "../SectionLabel";
import { TwoTone } from "../TwoTone";
import { Gallery } from "../Gallery";

export function SelectedWork() {
  const primary = sites.filter((s) => s.group === "primary").length;
  const events = sites.length - primary;
  return (
    <section id="gallery" aria-labelledby="gallery-label" className="border-b border-hairline">
      <div className="px-6 pt-16 pb-10 md:px-14 md:pt-24 md:pb-12">
        <SectionLabel index="02" id="gallery-label">
          Selected work
        </SectionLabel>
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end">
          <TwoTone line1="Work in the wild." line2={`${sites.length} live sites.`} className="lg:col-span-7" />
          <p className="max-w-[460px] text-[16px] leading-[1.6] text-body lg:col-span-5 lg:col-start-8">
            {primary} websites and {events} event pages, shown as live previews. Scroll the shelf, then open any of them in a new tab.
          </p>
        </div>
      </div>
      <div className="border-t border-hairline">
        <Gallery />
      </div>
    </section>
  );
}
