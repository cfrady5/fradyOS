"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Filter toolbar. Desktop shows the controls inline; phones get a "Filters" button that opens a
 * bottom sheet with the same controls stacked. The active-filter count sits on the button and on
 * a Reset action so the state is never hidden.
 */
export function FilterBar({
  view,
  search,
  children,
  activeCount = 0,
  onReset,
  className,
}: {
  /** View switcher (tabs) shown at the start of the first row. */
  view?: React.ReactNode;
  /** Search input shown at the end of the first row. */
  search?: React.ReactNode;
  /** Filter controls (selects, toggles). */
  children?: React.ReactNode;
  activeCount?: number;
  onReset?: () => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const hasFilters = React.Children.count(children) > 0;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {view || search || hasFilters ? (
        <div className="flex flex-wrap items-center gap-2">
          {view}
          <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto [&>*:first-child]:min-w-0 [&>*:first-child]:flex-1 sm:[&>*:first-child]:flex-none">
            {search}
            {hasFilters ? (
              <Button variant="outline" size="sm" className="md:hidden" onClick={() => setOpen(true)} aria-label={activeCount ? `Filters, ${activeCount} active` : "Filters"}>
                <SlidersHorizontal /> Filters
                {activeCount ? <span className="bg-brand nums ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white">{activeCount}</span> : null}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {hasFilters ? (
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          {children}
          {activeCount && onReset ? (
            <Button variant="ghost" size="sm" onClick={onReset} className="text-text-2">
              <X /> Reset
              <span className="index">{activeCount}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
      {hasFilters ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="md:hidden">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>{activeCount ? `${activeCount} active` : "Narrow the list"}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-2 overflow-y-auto px-4 [&_select]:w-full [&>*]:w-full">{children}</div>
            <SheetFooter className="flex-row justify-between">
              {activeCount && onReset ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    onReset();
                    setOpen(false);
                  }}
                >
                  <X /> Reset
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={() => setOpen(false)}>Done</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
