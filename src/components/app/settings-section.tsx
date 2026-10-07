import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Settings panel: a 15px heading, an optional one-line description and a trailing action on a
 * hairline, followed by the panel's fields. Flat by design, so settings never nest cards.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
  as: Tag = "h2",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <div className="border-line-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b pb-3">
        <div className="min-w-0">
          <Tag className="text-heading text-text-1 flex flex-wrap items-center gap-2">{title}</Tag>
          {description ? <p className="text-text-2 text-meta mt-1 max-w-2xl">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
