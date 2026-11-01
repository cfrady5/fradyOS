"use client";

import * as React from "react";
import { Capacitor } from "@capacitor/core";

const STATUS_BAR_COLOR = "#0e1014";

/**
 * Wires the web app to the Capacitor shell when it runs inside the iOS or Android app.
 *
 * - Marks `<html>` with `native` and `native-<platform>` so CSS can pad for the status bar.
 * - Sets the status bar to light text on the dark ground and hides the splash once React is up.
 * - Android back button walks history, then backgrounds the app at the root.
 * - Universal links and app links (magic-link emails) navigate inside the shell.
 * - Off-site links open in the system browser instead of taking over the WebView.
 *
 * On the plain web every effect returns early, and the plugin code is only loaded on demand.
 */
export function NativeBridge() {
  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const platform = Capacitor.getPlatform();
    const root = document.documentElement;
    root.classList.add("native", `native-${platform}`);

    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    (async () => {
      const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/status-bar"),
        import("@capacitor/splash-screen"),
      ]);
      if (cancelled) return;

      try {
        await StatusBar.setStyle({ style: Style.Dark });
        if (platform === "android") await StatusBar.setBackgroundColor({ color: STATUS_BAR_COLOR });
      } catch {
        // Status bar plugin is optional on unusual devices.
      }

      handles.push(
        await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack) window.history.back();
          else void App.minimizeApp();
        }),
      );

      handles.push(
        await App.addListener("appUrlOpen", ({ url }) => {
          const target = sameOriginPath(url);
          if (target) window.location.assign(target);
        }),
      );

      await SplashScreen.hide({ fadeOutDuration: 180 });
    })();

    return () => {
      cancelled = true;
      root.classList.remove("native", `native-${platform}`);
      for (const h of handles) void h.remove();
    };
  }, []);

  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin === window.location.origin) return;
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      event.preventDefault();
      void import("@capacitor/browser").then(({ Browser }) => Browser.open({ url: url.toString() }));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}

/** Returns the in-app path for a URL that belongs to this deployment, or null for anything else. */
export function sameOriginPath(raw: string, origin: string = window.location.origin): string | null {
  try {
    const url = new URL(raw);
    if (url.origin !== origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
