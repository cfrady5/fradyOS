import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell for FRADY OS.
 *
 * The app is server-rendered (Supabase auth, server actions), so the shell loads the deployed site
 * inside a native WebView instead of bundling a static export. `native/www` only holds the offline page.
 * Point the shell at a preview deployment with CAP_SERVER_URL before `npx cap sync`.
 */
const SITE_URL = process.env.CAP_SERVER_URL ?? "https://frady-os.vercel.app";

const config: CapacitorConfig = {
  appId: "com.frady.os",
  appName: "FRADY",
  webDir: "native/www",
  backgroundColor: "#0e1014",
  server: {
    url: SITE_URL,
    errorPath: "offline.html",
    cleartext: false,
  },
  ios: {
    // Content runs under the status bar; the web app pads with env(safe-area-inset-top) when `html.native` is set.
    contentInset: "never",
    preferredContentMode: "mobile",
    scheme: "frady",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#0e1014",
      androidScaleType: "CENTER_CROP",
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0e1014",
      overlaysWebView: false,
    },
  },
};

export default config;
