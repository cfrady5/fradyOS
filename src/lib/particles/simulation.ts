import * as THREE from "three";
import { GPUComputationRenderer, type Variable } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { POSITION_SHADER, VELOCITY_SHADER } from "./shaders/compute.glsl";
import { POINTS_FRAGMENT, POINTS_VERTEX } from "./shaders/points.glsl";
import { tokens } from "@/lib/site/tokens";
import type { TargetData } from "./types";

export interface SimulationOptions {
  /** Requested particle count; rounded up to a square texture. */
  count: number;
  halfFloat: boolean;
  reducedMotion: boolean;
  pointSize: number;
  pixelRatio: number;
}

type Mode = "loose" | "assembling" | "formed";

const PALETTE = {
  primary: new THREE.Color(tokens.ink),
  secondary: new THREE.Color(tokens.muted),
  accent: new THREE.Color(tokens.lichen),
  lichen: new THREE.Color(tokens.lichen),
  oak: new THREE.Color(tokens.oak),
};

/**
 * GPU particle simulation. Positions and velocities live in float textures and are advanced by two
 * fragment-shader passes per frame (GPUComputationRenderer); the render pass reads the position
 * texture per vertex. Nothing per-particle runs in JavaScript after setup: targets are uploaded as a
 * texture, and interaction arrives as a handful of uniforms.
 */
export class ParticleSimulation {
  readonly size: number;
  readonly count: number;
  readonly points: THREE.Points;
  private readonly gpu: GPUComputationRenderer;
  private readonly posVar: Variable;
  private readonly velVar: Variable;
  private readonly targetTex: THREE.DataTexture;
  private readonly colorTex: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly velU: Record<string, THREE.IUniform>;
  private readonly impulses = new Float32Array(16);
  private impulseCursor = 0;
  private mode: Mode = "loose";
  private modeSince = 0;
  private disperseUntil = -1;
  private time = 0;
  private spring = 0;
  private noise = 1.2;
  private pointerLocal = new THREE.Vector3();
  private pointerOn = false;
  motion = { turbulence: 0.3, spin: 0, pulse: 0.2 };
  private readonly opts: SimulationOptions;

  constructor(renderer: THREE.WebGLRenderer, opts: SimulationOptions) {
    this.opts = opts;
    this.size = Math.max(16, Math.ceil(Math.sqrt(opts.count)));
    this.count = this.size * this.size;
    const gpu = new GPUComputationRenderer(this.size, this.size, renderer);
    if (opts.halfFloat) gpu.setDataType(THREE.HalfFloatType);
    this.gpu = gpu;

    // Initial state: a loose cloud, each particle with a seed in position.w.
    const pos0 = gpu.createTexture();
    const vel0 = gpu.createTexture();
    const pd = pos0.image.data as Float32Array;
    for (let i = 0; i < this.count; i++) {
      pd[i * 4] = (Math.random() - 0.5) * 2.6;
      pd[i * 4 + 1] = (Math.random() - 0.5) * 1.8;
      pd[i * 4 + 2] = (Math.random() - 0.5) * 1.2;
      pd[i * 4 + 3] = Math.random();
    }
    this.velVar = gpu.addVariable("textureVelocity", VELOCITY_SHADER, vel0);
    this.posVar = gpu.addVariable("texturePosition", POSITION_SHADER, pos0);
    gpu.setVariableDependencies(this.velVar, [this.velVar, this.posVar]);
    gpu.setVariableDependencies(this.posVar, [this.velVar, this.posVar]);

    this.targetTex = new THREE.DataTexture(new Float32Array(this.count * 4), this.size, this.size, THREE.RGBAFormat, THREE.FloatType);
    this.targetTex.needsUpdate = true;
    this.colorTex = new THREE.DataTexture(new Float32Array(this.count * 4), this.size, this.size, THREE.RGBAFormat, THREE.FloatType);
    this.colorTex.needsUpdate = true;

    this.velU = this.velVar.material.uniforms;
    Object.assign(this.velU, {
      uTarget: { value: this.targetTex },
      uTime: { value: 0 },
      uDelta: { value: 0.016 },
      uSpring: { value: 0 },
      uDamping: { value: 0.92 },
      uNoiseAmp: { value: 1.2 },
      uNoiseScale: { value: 1.6 },
      uNoiseSpeed: { value: 0.35 },
      uIdleAmp: { value: 0.05 },
      uDisperse: { value: 0 },
      uPulse: { value: 0 },
      uPointer: { value: new THREE.Vector3(1e4, 1e4, 1e4) },
      uPointerActive: { value: 0 },
      uRepelRadius: { value: 0.32 },
      uRepelStrength: { value: 7 },
      uImpulses: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uImpulseSpeed: { value: 2.4 },
      uImpulseWidth: { value: 0.28 },
      uImpulseStrength: { value: 16 },
      uMaxSpeed: { value: 7 },
      uContainRadius: { value: 1.9 },
    });
    this.posVar.material.uniforms.uDelta = { value: 0.016 };

    const error = gpu.init();
    if (error !== null) throw new Error(error);

    // Render geometry: one vertex per texel, referencing its texel by `ref`.
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.count * 3);
    const refs = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      refs[i * 2] = ((i % this.size) + 0.5) / this.size;
      refs[i * 2 + 1] = (Math.floor(i / this.size) + 0.5) / this.size;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("ref", new THREE.BufferAttribute(refs, 2));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    this.material = new THREE.ShaderMaterial({
      vertexShader: POINTS_VERTEX,
      fragmentShader: POINTS_FRAGMENT,
      uniforms: {
        uPositions: { value: null },
        uVelocities: { value: null },
        uTarget: { value: this.targetTex },
        uColors: { value: this.colorTex },
        uPointSize: { value: opts.pointSize },
        uPixelRatio: { value: opts.pixelRatio },
        uVisible: { value: 1.0001 },
        uPrimary: { value: PALETTE.primary },
        uSecondary: { value: PALETTE.secondary },
        uAccent: { value: PALETTE.accent },
        uTint: { value: PALETTE.primary.clone() },
        uTintAmount: { value: 0 },
        uTime: { value: 0 },
        uTwinkle: { value: opts.reducedMotion ? 0 : 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Upload a formation. The spring pulls particles toward it from their current positions. */
  setTarget(target: TargetData) {
    const td = this.targetTex.image.data as Float32Array;
    const cd = this.colorTex.image.data as Float32Array;
    const n = Math.min(this.count, target.count);
    for (let i = 0; i < n; i++) {
      td[i * 4] = target.positions[i * 3];
      td[i * 4 + 1] = target.positions[i * 3 + 1];
      td[i * 4 + 2] = target.positions[i * 3 + 2];
      td[i * 4 + 3] = target.emphasis[i];
    }
    // Spare texels (count rounded up) share targets with the first particles.
    for (let i = n; i < this.count; i++) {
      const j = i % Math.max(1, n);
      td[i * 4] = td[j * 4];
      td[i * 4 + 1] = td[j * 4 + 1];
      td[i * 4 + 2] = td[j * 4 + 2];
      td[i * 4 + 3] = td[j * 4 + 3] * 0.6;
    }
    if (target.colors) {
      for (let i = 0; i < this.count; i++) {
        const j = i < n ? i : i % Math.max(1, n);
        cd[i * 4] = target.colors[j * 4];
        cd[i * 4 + 1] = target.colors[j * 4 + 1];
        cd[i * 4 + 2] = target.colors[j * 4 + 2];
        cd[i * 4 + 3] = target.colors[j * 4 + 3];
      }
    } else cd.fill(0);
    this.targetTex.needsUpdate = true;
    this.colorTex.needsUpdate = true;
    this.motion = target.motion;
    const tint = target.palette === "lichen" ? PALETTE.lichen : target.palette === "oak" ? PALETTE.oak : PALETTE.primary;
    (this.material.uniforms.uTint.value as THREE.Color).copy(tint);
    this.material.uniforms.uTintAmount.value = target.palette === "ink" ? 0 : 0.45;
  }

  /** Burst outward and go loose. */
  disperse() {
    this.disperseUntil = this.time + (this.opts.reducedMotion ? 0.15 : 0.35);
    this.setMode("loose");
  }

  /** Drift without a target (while generating, or after an error). */
  loosen() {
    this.setMode("loose");
  }

  /** Start pulling toward the current target. */
  assemble() {
    this.setMode("assembling");
  }

  private setMode(mode: Mode) {
    this.mode = mode;
    this.modeSince = this.time;
  }

  /** True once the formation has had time to settle. */
  isSettled(): boolean {
    return this.mode === "formed" && this.time - this.modeSince > 0.6;
  }

  get assembleDuration() {
    return this.opts.reducedMotion ? 0.9 : 2.0;
  }

  /** Pointer in the formation's local space, or null when it is off the canvas. */
  setPointer(local: THREE.Vector3 | null) {
    this.pointerOn = local !== null;
    if (local) this.pointerLocal.copy(local);
  }

  /** Expanding shell from `local`; up to four live at once. */
  impulse(local: THREE.Vector3) {
    const i = this.impulseCursor;
    this.impulseCursor = (i + 1) % 4;
    const v = (this.velU.uImpulses.value as THREE.Vector4[])[i];
    v.set(local.x, local.y, local.z, this.time + 0.001);
  }

  /** Fraction of particles drawn (adaptive density step without rebuilding). */
  setVisibleFraction(f: number) {
    this.material.uniforms.uVisible.value = Math.min(1.0001, Math.max(0.05, f));
  }

  setPixelRatio(dpr: number) {
    this.material.uniforms.uPixelRatio.value = dpr;
  }

  /** Advance one frame. `dt` in seconds. */
  step(dt: number) {
    const d = Math.min(1 / 30, Math.max(1 / 240, dt));
    this.time += d;
    const t = this.time;
    const rm = this.opts.reducedMotion;
    const turb = rm ? 0 : this.motion.turbulence;

    // Mode ramps.
    const K = 11;
    if (this.mode === "assembling") {
      const p = Math.min(1, (t - this.modeSince) / this.assembleDuration);
      const e = p * p * (3 - 2 * p);
      this.spring = K * e;
      this.noise = 1.2 * (1 - e) + (0.04 + 0.22 * turb) * e;
      if (p >= 1) this.setMode("formed");
    } else if (this.mode === "formed") {
      this.spring = K;
      this.noise = 0.04 + 0.22 * turb;
    } else {
      this.spring = 0.3; // a whisper of pull so a loose cloud still remembers its last shape
      this.noise = rm ? 0.5 : 1.2;
    }
    const disperse = this.disperseUntil > t ? Math.min(1, (this.disperseUntil - t) / 0.35) : 0;

    const u = this.velU;
    u.uTime.value = t;
    u.uDelta.value = d;
    u.uSpring.value = this.spring;
    u.uDamping.value = Math.pow(this.mode === "formed" ? 0.88 : 0.95, d * 60);
    u.uNoiseAmp.value = this.noise;
    u.uIdleAmp.value = rm ? 0 : 0.03 + 0.1 * turb;
    u.uDisperse.value = disperse;
    u.uPulse.value = this.mode === "formed" && !rm ? this.motion.pulse : 0;
    u.uPointerActive.value = this.pointerOn ? 1 : 0;
    if (this.pointerOn) (u.uPointer.value as THREE.Vector3).copy(this.pointerLocal);
    this.posVar.material.uniforms.uDelta.value = d;

    this.gpu.compute();
    this.material.uniforms.uPositions.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;
    this.material.uniforms.uVelocities.value = this.gpu.getCurrentRenderTarget(this.velVar).texture;
    this.material.uniforms.uTime.value = t;
  }

  dispose() {
    this.gpu.dispose();
    this.points.geometry.dispose();
    this.material.dispose();
    this.targetTex.dispose();
    this.colorTex.dispose();
  }
}
