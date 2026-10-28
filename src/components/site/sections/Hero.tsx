import { geist } from "@/app/fonts";
import { site } from "@/lib/site/copy";
import { PixelCanvas } from "../PixelCanvas";
import { TwoTone } from "../TwoTone";
import { Button } from "../Button";

/** Headline first, the description directly beneath it, then the two calls to action. */
export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-heading" className="relative overflow-hidden border-b border-hairline">
      <div className="absolute inset-0" aria-hidden="false">
        <PixelCanvas effect="hero" label="Field of dithered pixels. A green wave flows across it, a light follows the cursor, and clicks send a ripple across the field." fontFamily={geist.style.fontFamily} />
      </div>
      <div className="relative px-6 pt-32 pb-24 md:px-14 md:pt-48 md:pb-36">
        <div className="flex max-w-[780px] flex-col items-start">
          <TwoTone as="h1" size="h1" id="hero-heading" line1={site.hero.line1} line2={site.hero.line2} />
          <p className="lede mt-6 max-w-[540px]">{site.hero.intro}</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Button href={`mailto:${site.email}`}>{site.hero.primary}</Button>
            <Button href="#gallery" variant="secondary">
              {site.hero.secondary}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
