"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * Row-selection checkbox with a 32px hit area. The wrapping label forwards clicks to the 18px
 * control, so the visual stays small while the touch target meets the minimum.
 */
export function SelectCheckbox({ className, ...props }: React.ComponentProps<typeof Checkbox>) {
  return (
    <label className={cn("-m-1.5 flex size-8 shrink-0 cursor-pointer items-center justify-center", className)}>
      <Checkbox {...props} />
    </label>
  );
}

/**
 * Floating toolbar for bulk actions while rows are selected: raised chrome on a strong hairline.
 * It floats over the page, so it is one of the few surfaces that carries a shadow.
 */
export function BulkBar({ label, className, children, ...props }: Omit<React.ComponentProps<"div">, "aria-label"> & { label: string }) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn(
        "bg-surface-2 border-line-2 shadow-dialog fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-lg border p-2 md:inset-x-auto md:right-8 md:bottom-6 md:left-[calc(232px+2rem)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
