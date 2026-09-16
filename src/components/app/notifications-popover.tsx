"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { markAllNotificationsRead, markNotificationRead, refreshNotifications } from "@/actions/notifications";
import type { Notification } from "@/lib/types";
import { timeAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function NotificationsPopover({ initial }: { initial: Notification[] }) {
  const router = useRouter();
  const [items, setItems] = React.useState<Notification[]>(initial);
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const refreshed = React.useRef(false);

  const [prevInitial, setPrevInitial] = React.useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setItems(initial);
  }

  // Generate fresh reminders once per page load (server-side throttled to 10 min).
  React.useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    refreshNotifications().then((res) => {
      if (res.ok) {
        setItems(res.data.unread);
        if (res.data.created > 0) router.refresh();
      }
    });
  }, [router]);

  function dismiss(id: string) {
    setItems((xs) => xs.filter((x) => x.id !== id));
    startTransition(async () => {
      await markNotificationRead(id);
    });
  }

  const unread = items.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative">
          <Bell />
          {unread ? (
            <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <div className="flex items-center gap-1">
            {unread ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setItems([]);
                  startTransition(async () => {
                    await markAllNotificationsRead();
                  });
                }}
              >
                <CheckCheck /> Mark all read
              </Button>
            ) : null}
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-muted-foreground px-3 py-8 text-center text-sm">You&apos;re all caught up.</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id} className={cn("flex items-start gap-2 px-3 py-2.5", kindTone(n.kind))}>
                  <div className="min-w-0 flex-1">
                    {n.href ? (
                      <Link href={n.href} onClick={() => { setOpen(false); dismiss(n.id); }} className="block text-sm font-medium leading-5 hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium leading-5">{n.title}</p>
                    )}
                    {n.body ? <p className="text-muted-foreground text-xs">{n.body}</p> : null}
                    <p className="text-muted-foreground mt-0.5 text-[11px]">{timeAgo(n.created_at)}</p>
                  </div>
                  <Button variant="ghost" size="icon-xs" aria-label="Mark read" onClick={() => dismiss(n.id)}>
                    <Check />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t px-3 py-2 text-center">
          <Link href="/settings?tab=reminders" className="text-muted-foreground text-xs hover:underline" onClick={() => setOpen(false)}>
            Reminder settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function kindTone(kind: string) {
  if (kind.includes("overdue")) return "border-l-2 border-l-destructive";
  if (kind.includes("followup")) return "border-l-2 border-l-warning";
  if (kind.startsWith("event")) return "border-l-2 border-l-primary";
  return "";
}
