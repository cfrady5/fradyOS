import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClassName } from "./input";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(fieldClassName, "flex field-sizing-content min-h-16 w-full px-3 py-2 leading-relaxed", className)} {...props} />;
}

export { Textarea };
