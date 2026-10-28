import { cn } from "@/lib/utils";

/** Headline: first line in ink, optional second line in the muted grey. */
export function TwoTone({ as: Tag = "h2", id, line1, line2, size = "h2", className }: { as?: "h1" | "h2"; id?: string; line1: string; line2?: string; size?: "h1" | "h2"; className?: string }) {
  return (
    <Tag id={id} className={cn(size === "h1" ? "h1" : "h2", "text-balance", className)}>
      <span className="block text-ink">{line1}</span>
      {line2 ? <span className="block text-ink-muted">{line2}</span> : null}
    </Tag>
  );
}
