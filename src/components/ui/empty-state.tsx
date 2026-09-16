import * as React from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed text-center",
        compact ? "gap-1.5 px-4 py-6" : "gap-2 px-6 py-10",
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground [&>svg]:size-6">{icon}</div> : null}
      <p className={cn("font-medium", compact ? "text-sm" : "text-base")}>{title}</p>
      {description ? (
        <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
