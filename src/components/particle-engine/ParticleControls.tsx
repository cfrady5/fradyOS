"use client";

import { useRef } from "react";
import { EXAMPLE_PROMPTS } from "@/lib/ai/schema";

interface Props {
  busy: boolean;
  onPrompt: (prompt: string) => void;
  onImage: (file: File) => void;
  onReset: () => void;
}

/** Four example prompts, an image upload and a reset, as plain text buttons. */
export function ParticleControls({ busy, onPrompt, onImage, onReset }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[12px] tracking-[0.04em] text-label">
      {EXAMPLE_PROMPTS.map((p) => (
        <button key={p} type="button" disabled={busy} onClick={() => onPrompt(p)} className="transition-colors hover:text-ink disabled:hover:text-label">
          {p}
        </button>
      ))}
      <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="transition-colors hover:text-ink disabled:hover:text-label">
        Upload an image
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Upload an image for the particles to form"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImage(f);
          e.target.value = "";
        }}
      />
      <button type="button" onClick={onReset} className="ml-auto transition-colors hover:text-ink">
        Reset
      </button>
    </div>
  );
}
