import { site } from "@/lib/site/copy";
import { cn } from "@/lib/utils";
import { SectionHeader, SECTION_PAD } from "../SectionHeader";

/** Specialties: section heading and description, then the four areas as titled cells. */
export function Services() {
  const { heading, text, items } = site.services;
  return (
    <section id="services" aria-labelledby="services-heading" className={cn("border-b border-hairline", SECTION_PAD)}>
      <SectionHeader id="services-heading" line1={heading} text={text} />
      <ul className="mt-12 grid grid-cols-1 border border-hairline sm:grid-cols-2 md:mt-16 lg:grid-cols-4">
        {items.map((item, i) => (
          <li key={item.name} className={cn("px-6 py-8 md:px-8", i > 0 && "border-t border-hairline sm:border-t-0", i % 2 === 1 && "sm:border-l", i >= 2 && "sm:border-t lg:border-t-0", i === 2 && "lg:border-l")}>
            <h3 className="h3 text-ink">{item.name}</h3>
            <p className="mt-2 text-[15px] leading-[1.6] text-body">{item.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
