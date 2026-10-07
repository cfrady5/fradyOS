import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldClassName } from "./input";

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select data-slot="select" className={cn(fieldClassName, "h-9 w-full appearance-none py-1 pr-8 pl-3 [&>optgroup]:bg-popover [&>option]:bg-popover", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="text-text-3 pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2" />
    </div>
  );
}

export { NativeSelect };
