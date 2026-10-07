import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return <kbd className={cn("bg-surface-2 text-text-2 border-line-2 pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border px-1 font-mono text-[10px] font-medium select-none", className)} {...props} />;
}
