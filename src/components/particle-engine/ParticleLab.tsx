"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { geist } from "@/app/fonts";
import { detectTier, prefersReducedMotion, probeWebGL, type WebGLSupport } from "@/lib/particles/performance";
import { createLabController } from "@/lib/particles/transitions";
import { ParticleCanvas } from "./ParticleCanvas";
import { ParticleInput } from "./ParticleInput";
import { ParticleControls } from "./ParticleControls";
import { ParticleStatus } from "./ParticleStatus";

let supportCache: WebGLSupport | null = null;
const support = {
  subscribe: () => () => {},
  get: () => (supportCache ??= probeWebGL()),
  server: (): WebGLSupport => ({ ok: false, reason: "pending" }),
};

/** The full /lab experience: the canvas, the prompt bar, status and examples. Client only. */
export function ParticleLab() {
  const webgl = useSyncExternalStore(support.subscribe, support.get, support.server);
  const tier = useMemo(() => detectTier(), []);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const [count, setCount] = useState(tier.particles);
  const [controller] = useState(() =>
    createLabController({
      count: tier.particles,
      viewAspect: () => (typeof window === "undefined" ? 1.6 : window.innerWidth / window.innerHeight),
      fontFamily: geist.style.fontFamily,
      reducedMotion,
    }),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  // After a performance step-down the controller re-samples the current formation at the new count.
  useEffect(() => {
    controller.setCount(count);
  }, [controller, count]);

  const onLowFps = useCallback(() => {
    setCount((c) => {
      const next = Math.max(2_048, Math.round(c / 2));
      if (next !== c) setTimeout(() => void controller.reapply(), 0);
      return next;
    });
  }, [controller]);

  return (
    <div className="site relative h-svh w-full overflow-hidden bg-ground text-ink">
      {webgl.ok ? (
        <ParticleCanvas count={count} dpr={tier.dpr} halfFloat={webgl.halfFloat} reducedMotion={reducedMotion} mobile={tier.mobile} controller={controller} onLowFps={onLowFps} />
      ) : (
        <Fallback reason={webgl.reason} />
      )}

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-6 py-5 md:px-10">
        <Link href="/" className="pointer-events-auto text-[15px] font-medium tracking-[-0.01em] text-ink transition-colors hover:text-lichen">
          FRADY
        </Link>
        <p className="pointer-events-auto font-mono text-[12px] tracking-[0.04em] text-label">{count.toLocaleString()} particles</p>
      </header>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-5 md:px-10 md:pb-8">
        <div className="pointer-events-auto flex w-full max-w-[720px] flex-col gap-3">
          <ParticleStatus state={state} onRetry={controller.retry} />
          <ParticleInput busy={state.busy} onSubmit={controller.submit} />
          <ParticleControls busy={state.busy} onPrompt={controller.submit} onReset={controller.reset} />
        </div>
      </div>
    </div>
  );
}

function Fallback({ reason }: { reason: string }) {
  return (
    <div className="dot-field absolute inset-0 flex items-center justify-center p-8">
      {reason === "pending" ? null : (
        <div className="max-w-[460px] bg-ground/90 p-6">
          <h1 className="h3 text-ink">The particle lab needs WebGL2.</h1>
          <p className="mt-2 text-[15px] leading-[1.6] text-body">
            This browser reported: {reason}. The rest of the site works as usual; try a current desktop browser with hardware acceleration enabled.
          </p>
        </div>
      )}
    </div>
  );
}
