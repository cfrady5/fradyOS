import {
  Sun,
  FolderKanban,
  CheckSquare,
  Hourglass,
  CalendarDays,
  CalendarRange,
  Trophy,
  Wallet,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavGroup = "work" | "money" | "system";
export type NavItem = { href: string; label: string; icon: LucideIcon; key: string; group: NavGroup; mobile?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: Sun, key: "t", group: "work", mobile: true },
  { href: "/projects", label: "Projects", icon: FolderKanban, key: "p", group: "work" },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, key: "k", group: "work", mobile: true },
  { href: "/waiting", label: "Waiting On", icon: Hourglass, key: "w", group: "work" },
  { href: "/events", label: "Events", icon: CalendarDays, key: "e", group: "work" },
  { href: "/calendar", label: "Calendar", icon: CalendarRange, key: "c", group: "work", mobile: true },
  { href: "/completed", label: "Completed", icon: Trophy, key: "d", group: "work" },
  { href: "/finances", label: "Finances", icon: Wallet, key: "f", group: "money", mobile: true },
  { href: "/settings", label: "Settings", icon: Settings, key: "s", group: "system" },
];

export const NAV_GROUPS: { key: NavGroup; label: string | null }[] = [
  { key: "work", label: "Work" },
  { key: "money", label: "Money" },
  { key: "system", label: null },
];

/** Items shown in the mobile bottom bar (the rest live behind "More"). */
export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((i) => i.mobile);

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
