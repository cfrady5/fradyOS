import { geist } from "@/app/fonts";
import { site } from "@/lib/site";
import { SectionLabel } from "../SectionLabel";
import { TwoTone } from "../TwoTone";
import { Button } from "../Button";
import { FigureFrame } from "../FigureFrame";
import { PixelCanvas } from "../PixelCanvas";

export function StartSomething() {
  return (
    <section id="start" aria-labelledby="start-label" className="px-6 pt-16 pb-14 md:px-14 md:pt-24 md:pb-20">
      <SectionLabel index="03" id="start-label">
        Start something
      </SectionLabel>
      <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <TwoTone line1={site.start.line1} line2={site.start.line2} />
        <Button href={`mailto:${site.email}`}>{site.start.cta}</Button>
      </div>
      <FigureFrame index="04" caption="Dither / Wordmark particles" className="mt-14 bg-ground" bodyClassName="h-[36vw] max-h-[440px] min-h-[220px]">
        <PixelCanvas effect="wordmark" label="The word frady built from pixel particles. The cursor pushes pixels away, clicks send a shockwave, and they spring back into place." fontFamily={geist.style.fontFamily} />
      </FigureFrame>
    </section>
  );
}
