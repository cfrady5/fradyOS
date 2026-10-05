import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-colors overflow-hidden nums",
  {
    variants: {
      variant: {
        default: "border-primary/30 bg-primary/15 text-primary-soft",
        secondary: "border-border bg-secondary text-secondary-foreground",
        destructive: "border-destructive/30 bg-destructive/12 text-destructive",
        outline: "border-border text-foreground",
        success: "border-success/30 bg-success/12 text-success",
        warning: "border-warning/30 bg-warning/12 text-warning",
        muted: "border-border/60 bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
