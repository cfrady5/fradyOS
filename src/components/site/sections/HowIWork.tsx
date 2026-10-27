import { geist } from "@/app/fonts";
import { site } from "@/lib/site/copy";
import { SectionLabel } from "../SectionLabel";
import { TwoTone } from "../TwoTone";
import { CodeCard } from "../CodeCard";
import { FigureFrame } from "../FigureFrame";
import { PixelCanvas } from "../PixelCanvas";

export function HowIWork() {
  return (
    <section id="work" aria-labelledby="how-label" className="border-b border-hairline px-6 py-16 md:px-14 md:py-24">
      <SectionLabel index="01" id="how-label">
        How I work
      </SectionLabel>
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end">
        <TwoTone line1={site.how.line1} line2={site.how.line2} className="lg:col-span-7" />
        <p className="max-w-[460px] text-[16px] leading-[1.6] text-body lg:col-span-5 lg:col-start-8">{site.how.text}</p>
      </div>
      <div className="mt-12 grid grid-cols-1 border border-hairline lg:grid-cols-12">
        <CodeCard className="border-b border-hairline lg:col-span-5 lg:border-r lg:border-b-0" />
        <FigureFrame index="02" caption="Dither / Monogram" bordered={false} className="border-b border-hairline lg:col-span-3 lg:border-r lg:border-b-0" bodyClassName="min-h-[320px] px-6 py-10 lg:h-full">
          <PixelCanvas effect="monogram" label="Pixel letter f built from dithered squares. Pixels near the cursor light up green." fontFamily={geist.style.fontFamily} />
        </FigureFrame>
        <FigureFrame index="03" caption={<span className="normal-case">cubic-bezier(.65, 0, .35, 1) / 1.4s</span>} bordered={false} className="lg:col-span-4" bodyClassName="min-h-[320px] lg:h-full">
          <PixelCanvas effect="easing" label="Graph of the easing curve cubic-bezier 0.65, 0, 0.35, 1 with a marker travelling along it every 1.4 seconds." fontFamily={geist.style.fontFamily} />
        </FigureFrame>
      </div>
    </section>
  );
}
