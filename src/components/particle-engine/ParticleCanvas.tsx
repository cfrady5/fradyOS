"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Canvas } from "@react-three/fiber";
import type { LabController } from "@/lib/particles/transitions";
import { ParticleSystem } from "./ParticleSystem";

interface Props {
  count: number;
  dpr: number;
  halfFloat: boolean;
  reducedMotion: boolean;
  mobile: boolean;
  controller: LabController;
  onLowFps: () => void;
}

const visibility = {
  subscribe(cb: () => void) {
    document.addEventListener("visibilitychange", cb);
    return () => document.removeEventListener("visibilitychange", cb);
  },
  get: () => document.visibilityState === "visible",
  server: () => true,
};

/**
 * The WebGL surface. Pauses the frame loop while the tab is hidden, survives a lost context by
 * rebuilding the simulation when it comes back, and never re-renders on animation frames.
 */
export function ParticleCanvas({ count, dpr, halfFloat, reducedMotion, mobile, controller, onLowFps }: Props) {
  const visible = useSyncExternalStore(visibility.subscribe, visibility.get, visibility.server);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (!canvasEl) return;
    const onLost = (e: Event) => {
      e.preventDefault();
      setLost(true);
    };
    const onRestored = () => {
      setLost(false);
      setEpoch((n) => n + 1);
    };
    canvasEl.addEventListener("webglcontextlost", onLost);
    canvasEl.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvasEl.removeEventListener("webglcontextlost", onLost);
      canvasEl.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [canvasEl]);

  return (
    <Canvas
      key={epoch}
      dpr={[1, dpr]}
      frameloop={visible && !lost ? "always" : "never"}
      gl={{ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance", preserveDrawingBuffer: false }}
      camera={{ fov: 45, near: 0.1, far: 20, position: [0, 0, 3.2] }}
      onCreated={({ gl }) => {
        gl.setClearColor("#09090B", 1);
        setCanvasEl(gl.domElement);
      }}
      style={{ position: "absolute", inset: 0, touchAction: "none" }}
      aria-hidden="true"
    >
      <ParticleSystem key={`${epoch}-${count}`} count={count} halfFloat={halfFloat} reducedMotion={reducedMotion} mobile={mobile} controller={controller} onLowFps={onLowFps} />
    </Canvas>
  );
}
