"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sites, hostOf, GROUP_LABEL } from "@/data/sites";
import { LivePreview } from "./LivePreview";
import { cx } from "@/lib/cx";

/**
 * Horizontal, snap-scrolling rail of every live site. Native scrolling (trackpad, touch, keyboard
 * when the region is focused) plus two square buttons; the counter follows the scroll position.
 */
export function Gallery() {
  const rail = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const total = sites.length;

  const onScroll = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const w = card ? card.offsetWidth : 1;
    setIndex(Math.min(total - 1, Math.max(0, Math.round(el.scrollLeft / w))));
  }, [total]);

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  const step = (dir: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const w = card ? card.offsetWidth : el.clientWidth;
    el.scrollBy({ left: dir * w, behavior: "smooth" });
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-hairline px-6 py-3 md:px-14">
        <p className="label" aria-live="polite">
          <span className="text-ink">{String(index + 1).padStart(2, "0")}</span>
          <span className="mx-2 text-crosshair" aria-hidden="true">/</span>
          {String(total).padStart(2, "0")}
        </p>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => step(-1)} aria-label="Previous site" className="flex size-10 items-center justify-center border border-border-strong text-ink transition-colors hover:border-body">
            ←
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next site" className="flex size-10 items-center justify-center border border-border-strong text-ink transition-colors hover:border-body">
            →
          </button>
        </div>
      </div>
      <div ref={rail} role="region" aria-label="Gallery of live sites, scroll horizontally" tabIndex={0} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto outline-none focus-visible:outline-lichen">
        {sites.map((s, i) => (
          <article key={s.slug} className={cx("w-[86vw] shrink-0 snap-start sm:w-[min(72vw,600px)]", i < total - 1 && "border-r border-hairline")}>
            <div className="label flex h-10 items-center justify-between border-b border-hairline px-4">
              <span>
                <span className="text-ink">{String(i + 1).padStart(2, "0")}</span>
                <span className="mx-2 text-crosshair" aria-hidden="true">/</span>
                {s.name}
              </span>
              <span>{GROUP_LABEL[s.group]}</span>
            </div>
            <LivePreview url={s.url} name={s.name} mode={s.preview} />
            <div className="flex h-11 items-center justify-between border-t border-hairline px-4">
              <span className="label truncate">{hostOf(s.url)}</span>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="label shrink-0 text-ink transition-colors hover:text-lichen">
                Open <span aria-hidden="true">↗</span>
                <span className="sr-only"> {s.name} in a new tab</span>
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
