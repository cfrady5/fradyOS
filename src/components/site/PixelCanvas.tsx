"use client";

import { useEffect, useRef } from "react";
import { TUNING, registerPointerTarget } from "@/lib/pixel/pixelEngine";
import { EFFECTS, type EffectKind } from "@/lib/pixel/effects";
import { cn } from "@/lib/utils";

/**
 * Hosts one pixel effect on a Canvas 2D surface: DPR-aware sizing through ResizeObserver, one
 * requestAnimationFrame loop paused by IntersectionObserver when offscreen, pointer input from the
 * page-level bus, and reduced-motion handling (ambient animation stops, interaction still works).
 */
export function PixelCanvas({ effect, label, fontFamily = "sans-serif", className }: { effect: EffectKind; label: string; fontFamily?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fx = EFFECTS[effect]({ reducedMotion: media.matches, fontFamily });

    let width = 0;
    let height = 0;
    let raf = 0;
    let visible = false;
    let last = performance.now();
    let disposed = false;
    let resizing: Promise<void> | void;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (media.matches && fx.idle()) return;
      ctx.clearRect(0, 0, width, height);
      fx.frame(ctx, dt, now / 1000);
    };
    const loop = (now: number) => {
      raf = 0;
      if (disposed || !visible) return;
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf && visible && !disposed) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(TUNING.maxDpr, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      resizing = fx.resize(ctx, width, height);
      // Always paint at least one frame, so a still canvas is never blank (reduced motion, offscreen).
      Promise.resolve(resizing).then(() => {
        if (!disposed) {
          ctx.clearRect(0, 0, width, height);
          fx.frame(ctx, 0, performance.now() / 1000);
        }
      });
    };

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? false;
        if (visible) start();
      },
      { rootMargin: "64px" },
    );
    io.observe(canvas);
    const unregister = registerPointerTarget(canvas, fx);
    const onMotion = () => start();
    media.addEventListener("change", onMotion);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      unregister();
      media.removeEventListener("change", onMotion);
    };
  }, [effect, fontFamily]);

  return <canvas ref={ref} role="img" aria-label={label} className={cn("block h-full w-full", className)} style={{ pointerEvents: "none" }} />;
}
