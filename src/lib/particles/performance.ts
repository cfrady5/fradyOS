/**
 * Device tiering, capability probing and a frame-rate monitor for the particle engine.
 * Desktop starts at ~30k particles, phones at ~8k, low-power phones at ~4k; the FPS monitor can
 * step the engine down further at runtime.
 */

export interface DeviceTier {
  mobile: boolean;
  lowPower: boolean;
  /** Particle budget. The simulation rounds it to a square texture. */
  particles: number;
  /** Device pixel ratio cap for the canvas. */
  dpr: number;
}

export function detectTier(): DeviceTier {
  if (typeof navigator === "undefined") return { mobile: false, lowPower: false, particles: 30_000, dpr: 2 };
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const mobile = Boolean(nav.userAgentData?.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) || (coarse && Math.min(screen.width, screen.height) < 820);
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const lowPower = mobile && (cores <= 4 || memory <= 3);
  const saveData = (nav as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return {
    mobile,
    lowPower: lowPower || saveData,
    particles: lowPower || saveData ? 4_096 : mobile ? 8_100 : 30_276,
    dpr: mobile ? 1.5 : 2,
  };
}

export type WebGLSupport = { ok: true; halfFloat: boolean } | { ok: false; reason: string };

/** Can this browser run the GPU simulation? Needs WebGL2 with float (or half-float) colour buffers. */
export function probeWebGL(): WebGLSupport {
  if (typeof document === "undefined") return { ok: false, reason: "no document" };
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
    if (!gl) return { ok: false, reason: "WebGL2 is not available" };
    const float = gl.getExtension("EXT_color_buffer_float");
    const half = gl.getExtension("EXT_color_buffer_half_float");
    const vertexTextures = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number;
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    if (vertexTextures < 2) return { ok: false, reason: "the GPU cannot read textures in vertex shaders" };
    if (!float && !half) return { ok: false, reason: "the GPU cannot render to float textures" };
    return { ok: true, halfFloat: !float };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "WebGL failed to start" };
  }
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Rolling frame-rate average; calls `onLow` once each time the average stays under `threshold` for `holdSeconds`. */
export class FpsMonitor {
  private frames = 0;
  private elapsed = 0;
  private lowFor = 0;
  private cooldown = 0;
  fps = 60;
  constructor(
    private readonly onLow: () => void,
    private readonly threshold = 30,
    private readonly holdSeconds = 3,
  ) {}
  sample(dt: number) {
    this.frames++;
    this.elapsed += dt;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.elapsed < 1) return;
    this.fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    if (this.fps < this.threshold) {
      this.lowFor += 1;
      if (this.lowFor >= this.holdSeconds && this.cooldown <= 0) {
        this.lowFor = 0;
        this.cooldown = 6;
        this.onLow();
      }
    } else this.lowFor = 0;
  }
}
