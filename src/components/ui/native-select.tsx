import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "border-input bg-input-bg h-9 w-full appearance-none rounded-md border py-1 pr-8 pl-3 text-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&>option]:bg-popover",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export { NativeSelect };
