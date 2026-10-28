import { cn } from "@/lib/utils";
import { TwoTone } from "./TwoTone";

/**
 * Every section opens the same way: the heading, then its supporting copy directly beneath, both
 * left-aligned on the section's edge. Content follows at `mt-12 md:mt-16` in the section itself.
 */
export function SectionHeader({ id, line1, line2, text, className }: { id: string; line1: string; line2?: string; text?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("max-w-[780px]", className)}>
      <TwoTone id={id} line1={line1} line2={line2} />
      {text ? <p className="lede mt-5 max-w-[560px]">{text}</p> : null}
    </div>
  );
}

/** Shared section padding: generous vertical room between major sections, same edges everywhere. */
export const SECTION_PAD = "px-6 py-20 md:px-14 md:py-28 lg:py-32";
