import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Empty states say what is missing and offer one relevant action.
 * `inline` (default) is a quiet hairline row that sits where the list would be;
 * `page` is for a screen that is genuinely empty.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  variant = "inline",
  compact,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  variant?: "inline" | "page";
  /** @deprecated use variant="inline" (kept so older call sites keep compiling) */
  compact?: boolean;
}) {
  const inline = compact || variant === "inline";
  if (inline) {
    return (
      <div className={cn("border-line-1 text-text-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed px-3.5 py-3 text-sm", className)}>
        {icon ? <span className="text-text-3 [&>svg]:size-4">{icon}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="text-foreground font-medium">{title}</span>
          {description ? <span className="text-text-2"> · {description}</span> : null}
        </span>
        {action ? <span className="shrink-0">{action}</span> : null}
      </div>
    );
  }
  return (
    <div className={cn("border-line-1 bg-surface-1/60 flex flex-col items-start gap-2 rounded-lg border px-6 py-8 sm:px-8", className)}>
      {icon ? <div className="bg-surface-2 text-text-2 mb-1 flex size-10 items-center justify-center rounded-md [&>svg]:size-5">{icon}</div> : null}
      <p className="text-title text-foreground text-balance">{title}</p>
      {description ? <p className="text-text-2 max-w-md text-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
