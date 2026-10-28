"use client";

import { EXAMPLE_PROMPTS } from "@/lib/ai/schema";

interface Props {
  busy: boolean;
  onPrompt: (prompt: string) => void;
  onReset: () => void;
}

/** Four example prompts and a reset, as plain text buttons. */
export function ParticleControls({ busy, onPrompt, onReset }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[12px] tracking-[0.04em] text-label">
      {EXAMPLE_PROMPTS.map((p) => (
        <button key={p} type="button" disabled={busy} onClick={() => onPrompt(p)} className="transition-colors hover:text-ink disabled:hover:text-label">
          {p}
        </button>
      ))}
      <button type="button" onClick={onReset} className="ml-auto transition-colors hover:text-ink">
        Reset
      </button>
    </div>
  );
}
