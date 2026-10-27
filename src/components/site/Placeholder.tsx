import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { SectionLabel } from "./SectionLabel";
import { TwoTone } from "./TwoTone";
import { Button } from "./Button";

/** Stub page for nav destinations that do not have content yet. */
export function Placeholder({ index, title }: { index: string; title: string }) {
  return (
    <>
      <Nav />
      <main className="mx-4 min-h-screen border-x border-hairline md:mx-12">
        <section className="px-6 pt-40 pb-24 md:px-14">
          <SectionLabel index={index}>{title}</SectionLabel>
          <TwoTone as="h1" line1={`[${title}]`} line2="[Coming soon.]" className="mt-8" />
          <p className="mt-8 max-w-[520px] text-[17px] leading-[1.6] text-body">[Placeholder page. Replace this with the real {title.toLowerCase()} content.]</p>
          <div className="mt-10">
            <Button href="/" variant="secondary" arrow={false}>
              <span aria-hidden="true">←</span> Back home
            </Button>
          </div>
        </section>
        <Footer />
      </main>
    </>
  );
}
