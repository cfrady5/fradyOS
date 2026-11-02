"use client";

import * as React from "react";

/** Scrolls the `aria-current="page"` tab into view when a horizontally scrolling tab row mounts or the route changes. */
export function useActiveTabInView(pathname: string) {
  const ref = React.useRef<HTMLUListElement>(null);
  React.useEffect(() => {
    const list = ref.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !active) return;
    const left = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return ref;
}
