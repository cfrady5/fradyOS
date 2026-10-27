import { site } from "@/lib/site";

/** Four-cell strip under the hero: 01 / CONTENT … 04 / MOTION. */
export function Strip() {
  return (
    <section aria-label="Practice areas" className="grid grid-cols-1 border-b border-hairline sm:grid-cols-2 lg:grid-cols-4">
      {site.strip.map((cell, i) => (
        <div key={cell.index} className={["px-6 py-7 md:px-8", i > 0 ? "border-t border-hairline sm:border-t-0 sm:border-l" : "", i === 2 ? "sm:border-t lg:border-t-0" : "", i === 3 ? "sm:border-t lg:border-t-0" : ""].join(" ")}>
          <p className="label">
            {cell.index}
            <span className="mx-2 text-crosshair" aria-hidden="true">/</span>
            {cell.label}
          </p>
          <p className="mt-4 text-[15px] leading-[1.6] text-body">{cell.text}</p>
        </div>
      ))}
    </section>
  );
}
