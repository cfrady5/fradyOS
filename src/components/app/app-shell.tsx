"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Plus, Search, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NAV_ITEMS, isActive } from "./nav";
import { useWorkspace } from "./workspace-provider";
import { QuickAddDialog } from "./quick-add-dialog";
import { CommandPalette } from "./command-palette";
import { ItemSheet } from "./item-sheet";
import { NotificationsPopover } from "./notifications-popover";
import { KeyboardShortcuts, ShortcutsHelp } from "./keyboard-shortcuts";
import type { Notification } from "@/lib/types";

type ShellContextValue = {
  openQuickAdd: (preset?: QuickAddPreset) => void;
  openSearch: () => void;
};

export type QuickAddPreset = {
  project_id?: string | null;
  work_area_id?: string | null;
  event_id?: string | null;
  due_date?: string | null;
  planned_date?: string | null;
  status?: "inbox" | "todo" | "in_progress" | "waiting";
  title?: string;
};

const ShellContext = React.createContext<ShellContextValue | null>(null);

export function useShell() {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside AppShell");
  return ctx;
}

export function AppShell({ children, unreadNotifications }: { children: React.ReactNode; unreadNotifications: Notification[] }) {
  const pathname = usePathname();
  const ws = useWorkspace();
  const [quickAddOpen, setQuickAddOpen] = React.useState(false);
  const [quickAddPreset, setQuickAddPreset] = React.useState<QuickAddPreset | undefined>(undefined);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  const openQuickAdd = React.useCallback((preset?: QuickAddPreset) => {
    setQuickAddPreset(preset);
    setQuickAddOpen(true);
  }, []);
  const openSearch = React.useCallback(() => setSearchOpen(true), []);

  const [prevPathname, setPrevPathname] = React.useState(pathname);
  if (prevPathname !== pathname) {
    // Close the mobile drawer whenever navigation happens.
    setPrevPathname(pathname);
    setMobileNavOpen(false);
  }

  return (
    <TooltipProvider>
      <ShellContext.Provider value={{ openQuickAdd, openSearch }}>
        <div className="flex min-h-svh w-full">
          {/* Desktop sidebar */}
          <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 hidden h-svh w-56 shrink-0 flex-col border-r md:flex">
            <div className="flex h-14 items-center gap-2 px-4">
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">F</div>
              <span className="text-sm font-semibold tracking-tight">FRADY OS</span>
            </div>
            <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Main">
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="border-sidebar-border flex flex-col gap-2 border-t p-3">
              <Button variant="outline" size="sm" className="justify-between" onClick={() => setSearchOpen(true)}>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Search className="size-3.5" /> Search
                </span>
                <Kbd>⌘K</Kbd>
              </Button>
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{ws.displayName ?? ws.email ?? "Me"}</p>
                  <p className="text-muted-foreground truncate text-[11px]">{ws.timezone}</p>
                </div>
                <form action="/auth/signout" method="post">
                  <Button variant="ghost" size="icon-xs" type="submit" aria-label="Sign out" title="Sign out">
                    <LogOut />
                  </Button>
                </form>
              </div>
            </div>
          </aside>

          {/* Main column */}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur md:px-6">
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
                <Menu />
              </Button>
              <div className="flex items-center gap-2 md:hidden">
                <span className="text-sm font-semibold">FRADY OS</span>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setSearchOpen(true)}>
                  <Search />
                </Button>
                <NotificationsPopover initial={unreadNotifications} />
                <Button size="sm" className="hidden md:inline-flex" onClick={() => openQuickAdd()}>
                  <Plus /> New task <Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20">N</Kbd>
                </Button>
              </div>
            </header>
            <main className="flex-1 px-3 pt-4 pb-24 md:px-6 md:pb-10">{children}</main>
          </div>
        </div>

        {/* Mobile floating quick add */}
        <Button
          size="icon"
          className="fixed right-4 bottom-20 z-40 size-12 rounded-full shadow-lg md:hidden"
          aria-label="Quick add task"
          onClick={() => openQuickAdd()}
        >
          <Plus className="size-5" />
        </Button>

        {/* Mobile bottom nav */}
        <nav className="bg-background/95 fixed inset-x-0 bottom-0 z-30 flex border-t backdrop-blur md:hidden" aria-label="Mobile">
          {NAV_ITEMS.slice(0, 4).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="text-muted-foreground flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium"
          >
            <Menu className="size-5" />
            More
          </button>
        </nav>

        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-72">
            <SheetHeader>
              <SheetTitle>FRADY OS</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-0.5 px-2">
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium",
                      active ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-accent/60",
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto flex items-center justify-between border-t p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{ws.displayName ?? ws.email ?? "Me"}</p>
                <p className="text-muted-foreground truncate text-xs">{ws.email}</p>
              </div>
              <form action="/auth/signout" method="post">
                <Button variant="outline" size="sm" type="submit">
                  <LogOut /> Sign out
                </Button>
              </form>
            </div>
          </SheetContent>
        </Sheet>

        <QuickAddDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} preset={quickAddPreset} />
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
        <ItemSheet />
        <KeyboardShortcuts onQuickAdd={() => openQuickAdd()} onSearch={() => setSearchOpen(true)} onHelp={() => setHelpOpen(true)} />
        <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
      </ShellContext.Provider>
    </TooltipProvider>
  );
}
