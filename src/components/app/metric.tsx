import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type MetricTone = "good" | "warning" | "serious" | "critical" | "neutral";

const TONE_TEXT: Record<MetricTone, string> = {
  good: "text-success",
  warning: "text-warning",
  serious: "text-chart-serious",
  critical: "text-danger",
  neutral: "text-text-1",
};

/** Small qualifier beside a metric label: Current / Projected / Target / Connected / Manual. */
export function MetricTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("bg-surface-2 text-text-3 rounded-[4px] px-1 py-px text-[10px] font-semibold tracking-[0.08em] uppercase", className)}>{children}</span>;
}

/**
 * One number with its label. Values use tabular numerals; zero or empty values pass `muted` so
 * they recede instead of competing with the numbers that matter.
 */
export function Metric({
  label,
  value,
  sub,
  tone = "neutral",
  tag,
  href,
  size = "md",
  muted = false,
  align = "left",
  className,
  children,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: MetricTone;
  tag?: React.ReactNode;
  href?: string;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
  align?: "left" | "right";
  className?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <div className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1", align === "right" && "justify-end")}>
        <span className="eyebrow">{label}</span>
        {tag ? <MetricTag>{tag}</MetricTag> : null}
      </div>
      <div
        className={cn(
          "nums font-semibold tracking-tight",
          size === "sm" ? "text-lg leading-6" : size === "lg" ? "text-[1.75rem] leading-8 md:text-[2rem] md:leading-9" : "text-2xl leading-7",
          muted ? "text-text-3" : TONE_TEXT[tone],
        )}
      >
        {value}
      </div>
      {sub ? <div className="text-text-3 text-meta truncate">{sub}</div> : null}
      {children}
    </>
  );
  const cls = cn("flex min-w-0 flex-col gap-1", align === "right" && "items-end text-right", className);
  if (href) {
    return (
      <Link href={href} className={cn(cls, "hover:bg-surface-hover focus-visible:ring-brand/40 rounded-md transition-colors outline-none focus-visible:ring-2")}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

const COLS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
  6: "md:grid-cols-6",
};

/**
 * A row of metrics separated by hairlines, two per row on phones. Children are usually `Metric`s.
 */
export function MetricStrip({ children, cols, className }: { children: React.ReactNode; cols?: number; className?: string }) {
  const n = Math.min(6, Math.max(1, cols ?? React.Children.count(children)));
  return (
    <div
      className={cn(
        "border-line-1 bg-surface-1 grid grid-cols-2 overflow-hidden rounded-lg border",
        COLS[n],
        "[&>*]:border-line-1 [&>*]:px-4 [&>*]:py-3 [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t md:[&>*:nth-child(n+2)]:border-l md:[&>*:nth-child(n+3)]:border-t-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
