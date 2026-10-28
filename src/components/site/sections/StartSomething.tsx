import { geist } from "@/app/fonts";
import { site } from "@/lib/site/copy";
import { SectionHeader, SECTION_PAD } from "../SectionHeader";
import { Button } from "../Button";
import { FigureFrame } from "../FigureFrame";
import { PixelCanvas } from "../PixelCanvas";

/** Contact: heading, description, the call to action, then the interactive wordmark. */
export function StartSomething() {
  return (
    <section id="start" aria-labelledby="start-heading" className={SECTION_PAD}>
      <SectionHeader id="start-heading" line1={site.start.line1} line2={site.start.line2} text={site.start.text} />
      <Button href={`mailto:${site.email}`} className="mt-10">
        {site.start.cta}
      </Button>
      <FigureFrame className="mt-16 bg-ground md:mt-20" bodyClassName="h-[36vw] max-h-[440px] min-h-[220px]">
        <PixelCanvas effect="wordmark" label="The word frady built from pixel particles that flood in from the corners of the frame. The cursor pushes pixels away, clicks send a shockwave, and they spring back into place." fontFamily={geist.style.fontFamily} />
      </FigureFrame>
    </section>
  );
}
