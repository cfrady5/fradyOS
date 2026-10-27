import { cx } from "@/lib/cx";

/** Two-line headline: first line in ink, second in muted. */
export function TwoTone({ as: Tag = "h2", line1, line2, size = "h2", className }: { as?: "h1" | "h2"; line1: string; line2: string; size?: "h1" | "h2"; className?: string }) {
  return (
    <Tag className={cx(size === "h1" ? "h1" : "h2", "text-balance", className)}>
      <span className="block text-ink">{line1}</span>
      <span className="block text-muted">{line2}</span>
    </Tag>
  );
}
