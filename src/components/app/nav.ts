import {
  Sun,
  FolderKanban,
  CheckSquare,
  Hourglass,
  CalendarDays,
  CalendarRange,
  Trophy,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; key: string };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: Sun, key: "t" },
  { href: "/projects", label: "Projects", icon: FolderKanban, key: "p" },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, key: "k" },
  { href: "/waiting", label: "Waiting On", icon: Hourglass, key: "w" },
  { href: "/events", label: "Events", icon: CalendarDays, key: "e" },
  { href: "/calendar", label: "Calendar", icon: CalendarRange, key: "c" },
  { href: "/completed", label: "Completed", icon: Trophy, key: "d" },
  { href: "/settings", label: "Settings", icon: Settings, key: "s" },
];

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
