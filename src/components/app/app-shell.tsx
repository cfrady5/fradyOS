"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronsUpDown, CircleHelp, LogOut, Menu, Plus, Search, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
  const openHelp = React.useCallback(() => setHelpOpen(true), []);

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
          <aside className="bg-surface-0 border-line-1 sticky top-0 hidden h-svh w-[232px] shrink-0 flex-col border-r md:flex">
            <div className="flex h-14 items-center px-5">
              <Link href="/" className="focus-visible:ring-brand/40 rounded-sm outline-none focus-visible:ring-2">
                <Wordmark size="md" className="text-[17px]" />
              </Link>
            </div>
            <SidebarNav pathname={pathname} />
            <div className="border-line-1 border-t p-2">
              <AccountMenu />
            </div>
          </aside>

          {/* Main column */}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="bg-surface-0/85 supports-[backdrop-filter]:bg-surface-0/70 border-line-1 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur md:px-6">
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
                <Menu />
              </Button>
              <Link href="/" className="focus-visible:ring-brand/40 rounded-sm outline-none focus-visible:ring-2 md:hidden">
                <Wordmark size="md" />
              </Link>
              <button
                type="button"
                onClick={openSearch}
                className="bg-surface-1 border-line-1 text-text-3 hover:border-line-2 hover:text-text-2 focus-visible:ring-brand/40 hidden h-8 w-full max-w-[360px] items-center gap-2 rounded-md border px-2.5 text-[13px] transition-colors outline-none focus-visible:ring-2 md:flex"
                aria-label="Search (⌘K)"
              >
                <Search className="size-3.5" aria-hidden />
                <span className="flex-1 text-left">Search tasks, projects, events…</span>
                <Kbd>⌘K</Kbd>
              </button>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={openSearch}>
                  <Search />
                </Button>
                <Button variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={openHelp}>
                  <CircleHelp />
                </Button>
                <NotificationsPopover initial={unreadNotifications} />
                <Button size="sm" className="ml-1 hidden md:inline-flex" onClick={() => openQuickAdd()}>
                  <Plus /> Add task <Kbd className="ml-0.5 border-white/20 bg-white/15 text-white">N</Kbd>
                </Button>
              </div>
            </header>
            <main className="flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-7 md:pb-12">
              {/* Keyed by path so each page fades up once; search-param changes (detail sheet) do not re-run it. */}
              <div key={pathname} className="motion-safe:animate-page-in">
                {children}
              </div>
            </main>
          </div>
        </div>

        {/* Mobile floating quick add */}
        <Button size="icon" className="shadow-dialog fixed right-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 size-12 rounded-full md:hidden" aria-label="Add task" onClick={() => openQuickAdd()}>
          <Plus className="size-5" />
        </Button>

        {/* Mobile bottom nav */}
        <nav className="bg-surface-0/95 border-line-1 fixed inset-x-0 bottom-0 z-30 flex border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Mobile">
          {MOBILE_NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("focus-visible:ring-brand/40 flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset", active ? "text-text-1" : "text-text-3")}
              >
                <item.icon className={cn("size-5", active && "text-brand-soft")} strokeWidth={active ? 2 : 1.75} />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="text-text-3 focus-visible:ring-brand/40 flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset"
          >
            <Menu className="size-5" strokeWidth={1.75} />
            More
          </button>
        </nav>

        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-[85vw] max-w-xs gap-0 p-0">
            <SheetHeader className="h-14 justify-center px-5">
              <SheetTitle>
                <Wordmark size="md" className="text-[17px]" />
              </SheetTitle>
              <SheetDescription className="sr-only">Navigate between sections.</SheetDescription>
            </SheetHeader>
            <SidebarNav pathname={pathname} className="pt-1" />
            <div className="border-line-1 border-t p-2">
              <AccountMenu />
            </div>
          </SheetContent>
        </Sheet>

        <QuickAddDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} preset={quickAddPreset} />
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
        <ItemSheet />
        <KeyboardShortcuts onQuickAdd={() => openQuickAdd()} onSearch={openSearch} onHelp={openHelp} />
        <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
      </ShellContext.Provider>
    </TooltipProvider>
  );
}

/**
 * Grouped, numbered navigation ("01 Work", "02 Money"). A single brand bar slides to the active
 * item instead of each link painting its own, so moving between pages reads as one motion.
 */
function SidebarNav({ pathname, className }: { pathname: string; className?: string }) {
  const ref = React.useRef<HTMLElement>(null);
  const [bar, setBar] = React.useState<{ top: number; height: number } | null>(null);

  React.useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = nav.querySelector<HTMLElement>('a[aria-current="page"]');
        if (!el) return setBar(null);
        const navRect = nav.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        setBar({ top: r.top - navRect.top, height: r.height });
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [pathname]);

  return (
    <nav ref={ref} className={cn("relative flex flex-1 flex-col gap-5 overflow-y-auto px-3 pt-2 pb-3", className)} aria-label="Main">
      {bar ? (
        <span
          aria-hidden
          className="bg-brand pointer-events-none absolute left-0 w-0.5 rounded-r-full motion-safe:transition-[top,height] motion-safe:duration-200 motion-safe:ease-out"
          style={{ top: bar.top + 8, height: Math.max(0, bar.height - 16) }}
        />
      ) : null}
      {NAV_GROUPS.map((group) => {
        const items = NAV_ITEMS.filter((i) => i.group === group.key);
        if (!items.length) return null;
        return (
          <div key={group.key} className={cn("flex flex-col gap-px", group.key === "system" && "mt-auto")}>
            {group.label ? (
              <p className="flex items-center gap-2 px-2.5 pt-1 pb-2">
                <span className="index">{group.index}</span>
                <span className="eyebrow">{group.label}</span>
              </p>
            ) : null}
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group/nav focus-visible:ring-brand/40 relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-150 outline-none focus-visible:ring-2",
                    active ? "bg-surface-2 text-text-1" : "text-text-2 hover:bg-surface-1 hover:text-text-1",
                  )}
                >
                  <item.icon className={cn("size-4 transition-colors", active ? "text-brand-soft" : "text-text-3 group-hover/nav:text-text-2")} strokeWidth={1.75} />
                  <span className="flex-1 truncate">{item.label}</span>
                  <Kbd className="h-4 min-w-4 opacity-0 transition-opacity group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100" aria-hidden title={`Press G then ${item.key.toUpperCase()}`}>
                    {item.key.toUpperCase()}
                  </Kbd>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

/** Compact account control: initials, name and timezone, with a menu for settings and sign-out. */
function AccountMenu() {
  const ws = useWorkspace();
  const name = ws.displayName ?? ws.email ?? "Me";
  const tz = ws.timezone.split("/").pop()?.replace(/_/g, " ");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="hover:bg-surface-1 data-[state=open]:bg-surface-1 focus-visible:ring-brand/40 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2"
            aria-label="Account menu"
          >
            <span className="bg-surface-2 text-text-1 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" aria-hidden>
              {initials(name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-text-1 block truncate text-[13px] font-medium">{name}</span>
              <span className="text-text-3 block truncate text-[11px]">{tz}</span>
            </span>
            <ChevronsUpDown className="text-text-3 size-3.5 shrink-0" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" sideOffset={6} className="w-[216px]">
          <DropdownMenuLabel className="truncate">{ws.email ?? name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings /> Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings?tab=reminders">
              <Bell /> Reminders
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <button type="submit" form="signout-form" className="w-full">
              <LogOut /> Sign out
            </button>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form id="signout-form" action="/auth/signout" method="post" className="hidden" />
    </>
  );
}

function initials(name: string | null | undefined) {
  if (!name) return "ME";
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0]?.slice(0, 2) || "ME").toUpperCase();
}
