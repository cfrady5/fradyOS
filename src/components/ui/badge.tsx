import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Status badge. Tinted variants carry meaning (success / warning / destructive) and are always
 * paired with a label or icon by the caller, so meaning never depends on color alone.
 */
const badgeVariants = cva(
  "nums inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-1.5 py-px text-[11px] leading-4 font-medium whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-brand/15 text-brand-soft",
        secondary: "border-transparent bg-surface-3 text-text-1",
        muted: "border-transparent bg-surface-2 text-text-2",
        outline: "border-line-2 bg-transparent text-text-2",
        success: "border-transparent bg-success/14 text-success",
        warning: "border-transparent bg-warning/14 text-warning",
        destructive: "border-transparent bg-danger/14 text-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({ className, variant, asChild = false, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
