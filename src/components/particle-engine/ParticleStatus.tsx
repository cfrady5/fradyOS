"use client";

import type { LabState } from "@/lib/particles/transitions";

const LABELS: Record<LabState["phase"], string> = {
  IDLE: "",
  DISPERSING: "Letting go",
  GENERATING: "Interpreting",
  ASSEMBLING: "Assembling",
  FORMED: "Formed",
  INTERACTIVE: "",
  ERROR: "",
};

/** A quiet one-line status, an explanatory note when a stand-in form is shown, and the error with its retry. */
export function ParticleStatus({ state, onRetry }: { state: LabState; onRetry: () => void }) {
  const label = state.phase === "GENERATING" && state.interpretation?.method === "image" ? "Generating a silhouette" : LABELS[state.phase];
  return (
    <div className="min-h-[1.25rem] font-mono text-[12px] tracking-[0.04em]" aria-live="polite">
      {state.phase === "ERROR" ? (
        <p className="text-oak">
          {state.error}{" "}
          <button type="button" onClick={onRetry} className="text-ink underline decoration-border-strong underline-offset-4 hover:decoration-lichen">
            Retry
          </button>
        </p>
      ) : label ? (
        <p className="text-label">
          <span className="mr-2 inline-block size-[6px] animate-pulse bg-lichen align-middle" aria-hidden="true" />
          {label}
        </p>
      ) : state.note ? (
        <p className="text-label">{state.note}</p>
      ) : state.depth === "volume" && state.phase === "INTERACTIVE" ? (
        <p className="text-label">Drag to rotate. Click to send a pulse.</p>
      ) : null}
    </div>
  );
}
