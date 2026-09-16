"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { NAV_ITEMS } from "./nav";

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || el.closest("[role=dialog]") !== null;
}

export function KeyboardShortcuts({ onQuickAdd, onSearch, onHelp }: { onQuickAdd: () => void; onSearch: () => void; onHelp: () => void }) {
  const router = useRouter();
  const pendingG = React.useRef<number | null>(null);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onSearch();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      if (pendingG.current && Date.now() - pendingG.current < 1500) {
        const item = NAV_ITEMS.find((n) => n.key === e.key.toLowerCase());
        pendingG.current = null;
        if (item) {
          e.preventDefault();
          router.push(item.href);
          return;
        }
      }
      if (e.key === "g") {
        pendingG.current = Date.now();
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        onQuickAdd();
      } else if (e.key === "/") {
        e.preventDefault();
        onSearch();
      } else if (e.key === "?") {
        e.preventDefault();
        onHelp();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onQuickAdd, onSearch, onHelp, router]);

  return null;
}

export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work faster without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt><Kbd>N</Kbd></dt><dd>Quick add a task</dd>
          <dt><Kbd>⌘K</Kbd> / <Kbd>/</Kbd></dt><dd>Search everything</dd>
          <dt><Kbd>?</Kbd></dt><dd>Show this help</dd>
          {NAV_ITEMS.map((n) => (
            <React.Fragment key={n.href}>
              <dt><Kbd>G</Kbd> then <Kbd>{n.key.toUpperCase()}</Kbd></dt>
              <dd>Go to {n.label}</dd>
            </React.Fragment>
          ))}
          <dt><Kbd>Esc</Kbd></dt><dd>Close dialogs and panels</dd>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
