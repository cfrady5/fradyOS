"use client";

import { useEffect, useRef, useState } from "react";

/** Width and height of the virtual browser that each site is rendered in before scaling. */
const BASE_W = 1280;
const BASE_H = 800;

/**
 * A scaled, non-interactive live preview of an external site. The iframe mounts only while the
 * card is near the viewport and unmounts again when it scrolls away, so the page never holds more
 * than a few live embeds. A dotted placeholder sits underneath until the frame has loaded.
 */
export function LivePreview({ url, name, mode }: { url: string; name: string; mode: "live" | "link" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0.45);

  useEffect(() => {
    const el = ref.current;
    if (!el || mode !== "live") return;
    const io = new IntersectionObserver(
      (entries) => {
        const on = entries[0]?.isIntersecting ?? false;
        setNear(on);
        if (!on) setLoaded(false);
      },
      { rootMargin: "25% 320px" },
    );
    io.observe(el);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? BASE_W;
      setScale(w / BASE_W);
    });
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, [mode]);

  return (
    <div ref={ref} className="relative overflow-hidden bg-ground" style={{ aspectRatio: `${BASE_W} / ${BASE_H}` }}>
      {/* Placeholder: dotted field with the site name, shown until the live frame paints. */}
      <div aria-hidden="true" className="dot-field absolute inset-0 flex flex-col justify-between p-5">
        <span className="label">{mode === "live" ? (near ? "Loading live preview" : "") : "Preview opens off-site"}</span>
        <span className="text-[28px] leading-none font-medium tracking-[-0.03em] text-ink-muted">{name}</span>
      </div>
      {mode === "live" && near ? (
        <iframe
          src={url}
          title={`Live preview of ${name}`}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="strict-origin-when-cross-origin"
          tabIndex={-1}
          aria-hidden="true"
          onLoad={() => setLoaded(true)}
          className="absolute top-0 left-0 border-0 bg-ink"
          style={{ width: BASE_W, height: BASE_H, transform: `scale(${scale})`, transformOrigin: "top left", opacity: loaded ? 1 : 0, transition: "opacity 320ms ease-out", pointerEvents: "none" }}
        />
      ) : null}
    </div>
  );
}
