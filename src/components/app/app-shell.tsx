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
import { NAV_ITEMS, NAV_GROUPS, MOBILE_NAV_ITEMS, isActive } from "./nav";
import { Wordmark } from "./wordmark";
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
          <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r md:flex">
            <div className="flex h-16 items-center px-5">
              <Link href="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Wordmark size="md" className="text-lg" />
              </Link>
            </div>
            <nav className="flex flex-1 flex-col gap-5 px-3" aria-label="Main">
              {NAV_GROUPS.map((group) => {
                const items = NAV_ITEMS.filter((i) => i.group === group.key);
                if (!items.length) return null;
                return (
                  <div key={group.key} className={cn("flex flex-col gap-0.5", group.key === "system" && "mt-auto pb-2")}>
                    {group.label ? <p className="text-subtle-foreground px-3 pb-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase">{group.label}</p> : null}
                    {items.map((item) => {
                      const active = isActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                          )}
                        >
                          {active ? <span aria-hidden className="bg-primary absolute inset-y-2 left-0 w-0.5 rounded-full" /> : null}
                          <item.icon className={cn("size-[18px]", active ? "text-primary" : "text-sidebar-foreground/60")} strokeWidth={1.75} />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
            <div className="border-sidebar-border flex items-center justify-between gap-2 border-t px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="bg-secondary text-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{initials(ws.displayName ?? ws.email)}</div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{ws.displayName ?? ws.email ?? "Me"}</p>
                  <p className="text-subtle-foreground truncate text-[11px]">{ws.timezone.split("/").pop()?.replace(/_/g, " ")}</p>
                </div>
              </div>
              <form action="/auth/signout" method="post">
                <Button variant="ghost" size="icon-sm" type="submit" aria-label="Sign out" title="Sign out" className="text-muted-foreground">
                  <LogOut />
                </Button>
              </form>
            </div>
          </aside>

          {/* Main column */}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="bg-background/85 supports-[backdrop-filter]:bg-background/70 border-border sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur md:h-16 md:px-6">
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
                <Menu />
              </Button>
              <Link href="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden">
                <Wordmark size="md" />
              </Link>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="bg-input-bg border-input text-subtle-foreground hover:border-border hover:text-muted-foreground hidden h-9 w-full max-w-md items-center gap-2 rounded-md border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
                aria-label="Search (⌘K)"
              >
                <Search className="size-4" />
                <span className="flex-1 text-left">Search anything…</span>
                <Kbd>⌘K</Kbd>
              </button>
              <div className="ml-auto flex items-center gap-1.5">
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setSearchOpen(true)}>
                  <Search />
                </Button>
                <NotificationsPopover initial={unreadNotifications} />
                <Button size="sm" className="hidden md:inline-flex" onClick={() => openQuickAdd()}>
                  <Plus /> Add task <Kbd className="ml-1 border-white/20 bg-white/15 text-white">N</Kbd>
                </Button>
              </div>
            </header>
            <main className="flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-6 md:pb-12">{children}</main>
          </div>
        </div>

        {/* Mobile floating quick add */}
        <Button
          size="icon"
          className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 size-13 rounded-full shadow-lg shadow-black/40 md:hidden"
          aria-label="Add task"
          onClick={() => openQuickAdd()}
        >
          <Plus className="size-6" />
        </Button>

        {/* Mobile bottom nav */}
        <nav className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-30 flex border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Mobile">
          {MOBILE_NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", active ? "text-primary" : "text-muted-foreground")}
              >
                <item.icon className="size-5" strokeWidth={active ? 2 : 1.75} />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="text-muted-foreground flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <Menu className="size-5" strokeWidth={1.75} />
            More
          </button>
        </nav>

        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-72">
            <SheetHeader>
              <SheetTitle>
                <Wordmark size="md" className="text-lg" />
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-4 px-2">
              {NAV_GROUPS.map((group) => {
                const items = NAV_ITEMS.filter((i) => i.group === group.key);
                return (
                  <div key={group.key} className="flex flex-col gap-0.5">
                    {group.label ? <p className="text-subtle-foreground px-3 pb-1 text-[11px] font-semibold tracking-[0.12em] uppercase">{group.label}</p> : null}
                    {items.map((item) => {
                      const active = isActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium", active ? "bg-sidebar-accent text-foreground" : "text-foreground/80 hover:bg-sidebar-accent/60")}
                        >
                          <item.icon className={cn("size-[18px]", active ? "text-primary" : "text-muted-foreground")} strokeWidth={1.75} />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
            <div className="border-border mt-auto flex items-center justify-between border-t p-4">
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

function initials(name: string | null | undefined) {
  if (!name) return "ME";
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0]?.slice(0, 2) || "ME").toUpperCase();
}
