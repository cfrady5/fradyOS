"use client";

import { useState } from "react";
import { PROMPT_MAX_LENGTH } from "@/lib/ai/schema";
import { cn } from "@/lib/utils";

interface Props {
  busy: boolean;
  onSubmit: (prompt: string) => void;
}

/** One input, one button. Enter submits; the field stays editable while a formation is being built. */
export function ParticleInput({ busy, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const submit = () => {
    const v = value.trim();
    if (!v || busy) return;
    onSubmit(v);
    setValue("");
  };
  return (
    <form
      className="flex w-full items-stretch border border-border-strong bg-ground/80 backdrop-blur-md"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="lab-prompt" className="sr-only">
        Describe a shape for the particles to form
      </label>
      <input
        id="lab-prompt"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={PROMPT_MAX_LENGTH}
        placeholder="Describe something, or drop an image: a spiral galaxy, the word FRADY, a wolf howling at the moon"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        className="h-12 min-w-0 flex-1 bg-transparent px-4 text-[15px] text-ink outline-none placeholder:text-label"
      />
      <button type="submit" disabled={busy || !value.trim()} className={cn("h-12 shrink-0 px-5 text-[15px] font-medium transition-colors", busy || !value.trim() ? "text-label" : "bg-ink text-ground hover:bg-lichen")}>
        {busy ? "Working" : "Form it"}
      </button>
    </form>
  );
}
