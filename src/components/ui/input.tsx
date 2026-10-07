import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared field chrome for inputs, selects and textareas. */
export const fieldClassName =
  "border-line-2 bg-input-bg text-foreground placeholder:text-text-3 rounded-md border text-sm transition-[border-color,box-shadow,background-color] duration-150 outline-none hover:border-line-3 focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20 read-only:bg-surface-1";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClassName,
        "selection:bg-brand selection:text-primary-foreground file:text-foreground h-9 w-full min-w-0 px-3 py-1 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
