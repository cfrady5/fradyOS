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
        <div className="flex flex-col gap-4">
          <section>
            <p className="eyebrow mb-2">Actions</p>
            <dl className="hairline-rows text-sm">
              <ShortcutRow keys={[["N"]]}>Quick add a task</ShortcutRow>
              <ShortcutRow keys={[["⌘", "K"], ["/"]]}>Search everything</ShortcutRow>
              <ShortcutRow keys={[["?"]]}>Show this help</ShortcutRow>
              <ShortcutRow keys={[["Esc"]]}>Close dialogs and panels</ShortcutRow>
            </dl>
          </section>
          <section>
            <p className="eyebrow mb-2">Navigation</p>
            <dl className="hairline-rows text-sm">
              {NAV_ITEMS.map((n) => (
                <ShortcutRow key={n.href} keys={[["G", n.key.toUpperCase()]]}>
                  Go to {n.label}
                </ShortcutRow>
              ))}
            </dl>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One shortcut line: description on the left, key chords on the right. */
function ShortcutRow({ keys, children }: { keys: string[][]; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <dd className="text-text-2 m-0">{children}</dd>
      <dt className="flex items-center gap-1.5">
        {keys.map((chord, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <span className="text-text-3 text-meta">or</span> : null}
            <span className="inline-flex items-center gap-0.5">
              {chord.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </React.Fragment>
        ))}
      </dt>
    </div>
  );
}
