import { geist } from "@/app/fonts";
import { site } from "@/lib/site/copy";
import { cn } from "@/lib/utils";
import { SectionHeader, SECTION_PAD } from "../SectionHeader";
import { CodeCard } from "../CodeCard";
import { FigureFrame } from "../FigureFrame";
import { PixelCanvas } from "../PixelCanvas";

export function HowIWork() {
  return (
    <section id="work" aria-labelledby="how-heading" className={cn("border-b border-hairline", SECTION_PAD)}>
      <SectionHeader id="how-heading" line1={site.how.line1} line2={site.how.line2} text={site.how.text} />
      <div className="mt-12 grid grid-cols-1 border border-hairline md:mt-16 lg:grid-cols-12">
        <CodeCard className="border-b border-hairline lg:col-span-5 lg:border-r lg:border-b-0" />
        <FigureFrame bordered={false} className="border-b border-hairline lg:col-span-3 lg:border-r lg:border-b-0" bodyClassName="min-h-[320px] px-6 py-10 lg:h-full">
          <PixelCanvas effect="monogram" label="Pixel letter f built from dithered squares. Pixels near the cursor light up green." fontFamily={geist.style.fontFamily} />
        </FigureFrame>
        <FigureFrame bordered={false} className="lg:col-span-4" bodyClassName="min-h-[320px] lg:h-full">
          <PixelCanvas effect="easing" label="Graph of the easing curve cubic-bezier 0.65, 0, 0.35, 1 with a marker travelling along it every 1.4 seconds." fontFamily={geist.style.fontFamily} />
        </FigureFrame>
      </div>
    </section>
  );
}
