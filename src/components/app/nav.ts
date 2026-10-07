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

/** Navigation groups carry a quiet two-digit index ("01 Work") that page eyebrows reuse for orientation. */
export const NAV_GROUPS: { key: NavGroup; label: string | null; index: string | null }[] = [
  { key: "work", label: "Work", index: "01" },
  { key: "money", label: "Money", index: "02" },
  { key: "system", label: null, index: null },
];

/** Items shown in the mobile bottom bar (the rest live behind "More"). */
export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((i) => i.mobile);

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Where a path sits in the navigation: its item, its group and whether it is a nested page. */
export function navCrumb(pathname: string) {
  const item = NAV_ITEMS.find((i) => isActive(pathname, i.href));
  if (!item) return null;
  const group = NAV_GROUPS.find((g) => g.key === item.group) ?? NAV_GROUPS[0];
  return { item, group, nested: pathname !== item.href };
}
