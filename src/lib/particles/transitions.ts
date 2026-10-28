import type { Interpretation } from "@/lib/ai/schema";
import { ImageResponseSchema, InterpretResponseSchema } from "@/lib/ai/schema";
import { interpretDeterministic } from "@/lib/ai/rules";
import { buildTarget } from "./targetGenerator";
import type { LabPhase, TargetData } from "./types";

/** What the scene component gives the controller. Methods map onto `ParticleSimulation`. */
export interface EngineHandle {
  setTarget(target: TargetData): void;
  disperse(): void;
  loosen(): void;
  assemble(): void;
  isSettled(): boolean;
}

export interface LabState {
  phase: LabPhase;
  /** The prompt being shown or built. */
  prompt: string;
  /** Error text for the ERROR phase. */
  error: string | null;
  /** A quiet explanation, e.g. that a procedural form stands in for an image. */
  note: string | null;
  interpretation: Interpretation | null;
  depth: TargetData["depth"];
  busy: boolean;
}

export interface ControllerOptions {
  /** Initial particle count; change it with `setCount` after a performance step-down. */
  count: number;
  viewAspect: () => number;
  fontFamily: string;
  reducedMotion: boolean;
  initialPrompt?: string;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The prompt → formation state machine:
 * IDLE → DISPERSING → GENERATING → ASSEMBLING → FORMED → INTERACTIVE, or ERROR with retry.
 * One submission at a time; the engine is never rebuilt between prompts, only re-targeted.
 */
export function createLabController(opts: ControllerOptions) {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  let engine: EngineHandle | null = null;
  let pendingTarget: TargetData | null = null;
  let lastInterpretation: Interpretation | null = null;
  let imageProviderAvailable: boolean | null = null;
  let lastImageError: string | null = null;
  let run = 0;
  let count = opts.count;
  let state: LabState = { phase: "IDLE", prompt: "", error: null, note: null, interpretation: null, depth: "relief", busy: false };
  const listeners = new Set<() => void>();

  const set = (patch: Partial<LabState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  async function interpret(prompt: string, signal: AbortSignal): Promise<Interpretation> {
    const res = await fetchImpl("/api/lab/interpret", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }), signal });
    if (res.status === 429) throw new Error("Too many prompts in a row. Give it a moment, then try again.");
    if (!res.ok) throw new Error("The interpreter is unavailable right now. Try again in a moment.");
    const parsed = InterpretResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("The interpreter returned something unexpected. Try again.");
    imageProviderAvailable = parsed.data.imageProvider;
    return parsed.data.interpretation;
  }

  async function fetchImage(subject: string, signal: AbortSignal): Promise<string | null> {
    if (imageProviderAvailable === false) return null;
    const res = await fetchImpl("/api/lab/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject }), signal });
    if (res.status === 503) return null;
    if (res.status === 429) throw new Error("Image generation is busy. Give it a moment, then try again.");
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      lastImageError = body?.message ?? `HTTP ${res.status}`;
      return null;
    }
    const parsed = ImageResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.image : null;
  }

  /** Build a target for an interpretation at the current particle count. */
  async function build(interp: Interpretation, signal: AbortSignal): Promise<{ target: TargetData; note: string | null }> {
    let imageTried = false;
    lastImageError = null;
    const { target, fallback } = await buildTarget(interp, {
      count,
      viewAspect: opts.viewAspect(),
      fontFamily: opts.fontFamily,
      fetchImage: async (subject) => {
        imageTried = true;
        return fetchImage(subject, signal);
      },
    });
    let note: string | null = null;
    if (fallback === "procedural") {
      note =
        imageTried && imageProviderAvailable === false
          ? `Image generation is not configured on this site, so this is a procedural form for "${interp.subject}".`
          : lastImageError
            ? `Image generation failed (${lastImageError}), so this is a procedural form for "${interp.subject}".`
            : `No usable image came back, so this is a procedural form for "${interp.subject}".`;
    }
    return { target, note };
  }

  async function assembleInto(target: TargetData, myRun: number) {
    if (!engine) {
      pendingTarget = target;
      return;
    }
    engine.setTarget(target);
    engine.assemble();
    set({ phase: "ASSEMBLING", depth: target.depth });
    // Wait for the springs to settle, with an upper bound so the UI never hangs on a slow frame loop.
    const started = Date.now();
    while (!engine.isSettled() && Date.now() - started < 6000) {
      await sleep(100);
      if (myRun !== run) return;
    }
    if (myRun !== run) return;
    set({ phase: "FORMED" });
    await sleep(opts.reducedMotion ? 150 : 500);
    if (myRun !== run) return;
    set({ phase: "INTERACTIVE", busy: false });
  }

  async function submit(prompt: string, options: { initial?: boolean } = {}) {
    const clean = prompt.trim();
    if (!clean || state.busy) return;
    const myRun = ++run;
    const controller = new AbortController();
    set({ busy: true, prompt: clean, error: null, note: null });
    try {
      if (!options.initial && engine) {
        engine.disperse();
        set({ phase: "DISPERSING" });
      }
      // Interpret while the burst plays, then build the target. Text and geometry the rules already
      // recognise never leave the browser; the initial and reset formations therefore need no network.
      const local = interpretDeterministic(clean);
      const interpPromise = options.initial || local.method !== "image" ? Promise.resolve(local) : interpret(clean, controller.signal);
      if (!options.initial) await sleep(opts.reducedMotion ? 150 : 450);
      if (myRun !== run) return;
      set({ phase: "GENERATING" });
      const interp = await interpPromise;
      if (myRun !== run) return;
      lastInterpretation = interp;
      set({ interpretation: interp });
      const { target, note } = await build(interp, controller.signal);
      if (myRun !== run) return;
      set({ note });
      await assembleInto(target, myRun);
    } catch (error) {
      if (myRun !== run) return;
      engine?.loosen();
      set({ phase: "ERROR", busy: false, error: error instanceof Error ? error.message : "Something went wrong." });
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    attach(e: EngineHandle) {
      engine = e;
      if (pendingTarget) {
        const t = pendingTarget;
        pendingTarget = null;
        void assembleInto(t, run);
      } else if (state.phase === "IDLE") {
        void submit(opts.initialPrompt ?? "FRADY", { initial: true });
      }
    },
    detach() {
      engine = null;
    },
    submit: (prompt: string) => submit(prompt),
    retry: () => submit(state.prompt),
    reset: () => {
      run++;
      set({ busy: false, error: null, note: null });
      void submit(opts.initialPrompt ?? "FRADY");
    },
    /** Lower (or raise) the particle budget; call `reapply` afterwards to re-sample the formation. */
    setCount(next: number) {
      count = next;
    },
    /** Re-sample the current formation (after the particle count changed). */
    async reapply() {
      if (!lastInterpretation || !engine) return;
      const myRun = ++run;
      set({ busy: true });
      try {
        const { target, note } = await build(lastInterpretation, new AbortController().signal);
        if (myRun !== run) return;
        set({ note });
        await assembleInto(target, myRun);
      } catch {
        set({ busy: false, phase: "INTERACTIVE" });
      }
    },
  };
}

export type LabController = ReturnType<typeof createLabController>;
