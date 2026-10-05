import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "bg-background text-muted-foreground border-border pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-[10px] font-medium select-none",
        className,
      )}
      {...props}
    />
  );
}
