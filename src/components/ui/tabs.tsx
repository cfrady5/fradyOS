"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex min-w-0 max-w-full flex-col gap-3", className)} {...props} />;
}

/**
 * Segmented control. The active background is a single indicator element that slides between
 * triggers, so switching views reads as one piece moving rather than two things blinking.
 */
function TabsList({ className, children, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null);

  React.useEffect(() => {
    const list = ref.current;
    if (!list) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = list.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-state="active"]');
        setIndicator(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    const mo = new MutationObserver(measure);
    mo.observe(list, { attributes: true, subtree: true, attributeFilter: ["data-state"], childList: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={ref}
      data-slot="tabs-list"
      className={cn("bg-surface-1 border-line-1 text-text-2 relative inline-flex h-9 w-fit max-w-full items-center justify-start overflow-x-auto rounded-md border p-1 [scrollbar-width:none]", className)}
      {...props}
    >
      {indicator ? (
        <span
          aria-hidden
          data-slot="tabs-indicator"
          className="bg-surface-3 motion-safe:transition-[left,width] pointer-events-none absolute top-1 bottom-1 rounded-[6px] duration-200 ease-out"
          style={{ left: indicator.left, width: indicator.width }}
        />
      ) : null}
      {children}
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "hover:text-foreground data-[state=active]:text-foreground focus-visible:ring-brand/30 relative z-10 inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // Fallback tint before the indicator has been measured (first paint, reduced motion).
        "data-[state=active]:[&:not(:has(~[data-slot=tabs-indicator]))]:bg-surface-3",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("motion-safe:animate-fade-in flex-1 outline-none", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
