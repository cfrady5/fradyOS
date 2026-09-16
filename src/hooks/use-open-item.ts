"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Opens a task or social post in the global detail sheet by setting a URL search param.
 * The current page stays mounted underneath, so editing never loses your place.
 */
export function useOpenItem() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const build = useCallback(
    (key: "task" | "post", id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("task");
      params.delete("post");
      if (id) params.set(key, id);
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  const openTask = useCallback((id: string) => router.push(build("task", id), { scroll: false }), [router, build]);
  const openPost = useCallback((id: string) => router.push(build("post", id), { scroll: false }), [router, build]);
  const close = useCallback(() => router.replace(build("task", null), { scroll: false }), [router, build]);

  return { openTask, openPost, close, taskHref: (id: string) => build("task", id), postHref: (id: string) => build("post", id) };
}
