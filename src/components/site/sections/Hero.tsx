import { geist } from "@/app/fonts";
import { site } from "@/lib/site/copy";
import { PixelCanvas } from "../PixelCanvas";
import { StatusChip } from "../StatusChip";
import { TwoTone } from "../TwoTone";
import { Button } from "../Button";
import { FigureFrame } from "../FigureFrame";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden border-b border-hairline">
      <div className="absolute inset-0" aria-hidden="false">
        <PixelCanvas effect="hero" label="Field of dithered pixels. A light follows the cursor and clicks send a ripple across the field." fontFamily={geist.style.fontFamily} />
      </div>
      <div className="relative grid grid-cols-1 gap-x-6 gap-y-12 px-6 pt-36 pb-16 md:px-14 md:pt-44 md:pb-24 lg:grid-cols-12">
        <div className="flex flex-col items-start lg:col-span-7">
          <StatusChip>{site.hero.chip}</StatusChip>
          <TwoTone as="h1" size="h1" line1={site.hero.line1} line2={site.hero.line2} className="mt-8" />
          <p className="mt-7 max-w-[540px] text-[17px] leading-[1.6] text-body">{site.hero.intro}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button href={`mailto:${site.email}`}>{site.hero.primary}</Button>
            <Button href="#gallery" variant="secondary">
              {site.hero.secondary}
            </Button>
          </div>
          <p className="label mt-12">{site.hero.hint}</p>
        </div>
        <div className="flex items-center lg:col-span-5 lg:justify-end">
          <FigureFrame index="01" caption="Dither / Frady orb" className="w-full max-w-[440px] bg-ground" bodyClassName="aspect-square p-5">
            <PixelCanvas effect="orb" label="Dithered sphere lit from the direction of the cursor. Click to send a pulse across its surface." fontFamily={geist.style.fontFamily} />
          </FigureFrame>
        </div>
      </div>
    </section>
  );
}
