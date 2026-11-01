# FRADY native apps (iOS and Android)

The App Store and Play Store builds are a Capacitor shell around the deployed web app. The shell loads
https://frady-os.vercel.app inside a native WebView, so every screen, server action and Supabase session
works exactly as on the web, and shipping a web change does not require a store release. Native plugins
(status bar, splash screen, back button, system browser) are wired by `src/components/native/NativeBridge.tsx`,
which does nothing when the site runs in a normal browser.

## What is in the repo

| Path | Purpose |
| --- | --- |
| `capacitor.config.ts` | App id `com.frady.os`, name FRADY, remote `server.url`, status bar and splash settings |
| `ios/` | Xcode project (Swift Package Manager, no CocoaPods needed) |
| `android/` | Android Studio / Gradle project with the app-link intent filter for `/auth/*` |
| `native/www/` | Offline page shown when the site cannot be reached |
| `assets/` | Source icon and splash images; `npm run cap:assets` regenerates every platform size |
| `src/lib/native/deepLinks.ts` | Serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from env vars |

Generated copies (`ios/App/App/public`, `android/app/src/main/assets/public`, platform `capacitor.config.json`)
are gitignored and recreated by `npx cap sync`.

## Prerequisites (on a Mac)

- Node 22 and `npm install` in this repo
- Xcode 16 or newer with the iOS simulator, plus an Apple Developer Program membership for device builds and the App Store
- Android Studio (Ladybug or newer) with an SDK platform 35 image, plus a Google Play developer account for the Play Store

## First run

```bash
npm install
npm run cap:sync        # copies native/www and the plugin list into ios/ and android/
npm run cap:ios         # opens Xcode
npm run cap:android     # opens Android Studio
```

In Xcode: select the App target, set your Team under Signing and Capabilities, pick a simulator or a plugged-in
iPhone and press Run. In Android Studio: let Gradle sync, pick an emulator or device and press Run.
The app boots to the splash, then the live site. Sign in with email and password as on the web.

To point a build at a preview deployment instead of production:

```bash
CAP_SERVER_URL=https://frady-os-git-my-branch-cfrady.vercel.app npm run cap:sync
```

## Magic-link sign-in inside the app

Password sign-in works out of the box. Magic links open in the phone's browser unless the OS is told the app
owns `https://frady-os.vercel.app/auth/*`. Two one-time steps enable that:

1. **iOS.** In Xcode, Signing and Capabilities, add the Associated Domains capability with
   `applinks:frady-os.vercel.app` and `webcredentials:frady-os.vercel.app`. Then set `APPLE_TEAM_ID` (your 10-character
   Team ID) in the Vercel project and redeploy. The site then serves `/.well-known/apple-app-site-association`.
2. **Android.** Get the SHA-256 fingerprint of the signing key (Play Console, Setup, App signing for the Play key;
   `./gradlew signingReport` for debug keys). Set `ANDROID_SHA256_CERT_FINGERPRINTS` (comma-separated) in Vercel and
   redeploy. The site then serves `/.well-known/assetlinks.json`, and the manifest already carries the `autoVerify` filter.

Both routes return 404 until the variable is set, so nothing changes for the web until you are ready.

## Icons and splash

`assets/icon-only.png`, `icon-foreground.png`, `icon-background.png`, `splash.png` and `splash-dark.png` were rendered
from `src/app/icon.svg`. Replace any of them and run `npm run cap:assets` to regenerate the iOS asset catalog and the
Android mipmaps and drawables.

## Releasing

- **App Store.** Bump `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in Xcode, Product, Archive, then Distribute App
  to App Store Connect. TestFlight builds come from the same archive.
- **Play Store.** Bump `versionCode` and `versionName` in `android/app/build.gradle`, then Build, Generate Signed Bundle
  (AAB) and upload it in the Play Console.

Because the UI is served from Vercel, a store release is only needed when the native shell itself changes
(new plugin, new icon, new version number).

## Behaviour inside the shell

- `<html>` gets `native` and `native-ios` or `native-android`; `globals.css` pads the app header, sheets and the public
  site for the status bar inset.
- The Android back button walks browser history and backgrounds the app at the root.
- Links to other sites open in the system browser; links within the deployment stay in the WebView.
- If the site is unreachable the shell shows `native/www/offline.html` with a retry button.

## Not yet in the shell

- Bluetooth pairing for the WHOOP strap (NOOP phase 2) will need a native Bluetooth plugin; the shell makes that possible on iPhone later.
- Push notifications. The web notifications centre still works inside the app.
