# Mobile shell spike (Android)

The Android half of the RFC 0004 mobile spike (section 7): a Farm app wrapped in a native
shell in the style of Hotwire Native. Not a single WebView wrapper. The shell owns the tabs, the
stacks, the modal and back; every screen is one WebView showing a Farm page.

This is a spike. The shell under `android/` is hand-written but shaped like what
`farm build --mobile` would generate.

## What is here

```text
src/app/                  the Farm app (React)
  notes/page.tsx          /notes        list (tab root)
  notes/[id]/page.tsx     /notes/:id    detail (push)
  notes/new/page.tsx      /notes/new    form (modal), posts to /api/notes
  settings/page.tsx       /settings     haptics demo (tab root)
  settings/about/         /settings/about (push on the second tab)
  api/notes/route.ts      GET and POST /api/notes
src/lib/native.ts         typed `native` proxy with web fallbacks
mobile.config.mjs         tabs, per-route presentation, pool, plugins
scripts/generate-routes.mjs   writes android/.../assets/farm-routes.json
android/                  Kotlin + Views shell (AppCompat, Material, androidx.webkit)
  Navigator.kt            tabs, per-tab stacks, push/pop, modal, predictive back
  WebViewPool.kt          pre-warmed WebViews
  Page.kt                 one WebView + its bridge, link interception
  FarmBridge.kt           message bridge (request ids, Promise resolution)
  HapticsPlugin.kt        native.haptics.impact(style)
  assets/farm-bridge.js   injected at document start for the app origin only
```

## Run it

```sh
pnpm install
pnpm --filter farm-example-mobile-shell exec farm generate
pnpm --filter farm-example-mobile-shell mobile:routes   # farm-routes.json from src/farm.d.ts + mobile.config.mjs

# dev: the shell loads farm dev from the host (10.0.2.2 in the emulator)
pnpm --filter farm-example-mobile-shell dev
cd examples/mobile-shell/android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.farmjs.mobileshell/.MainActivity

# production server instead of farm dev
pnpm --filter farm-example-mobile-shell build
pnpm --filter farm-example-mobile-shell start            # 127.0.0.1:3001
adb shell am start -S -n dev.farmjs.mobileshell/.MainActivity -e server http://10.0.2.2:3001

# every push cold (no pool), to compare
adb shell am start -S -n dev.farmjs.mobileshell/.MainActivity --ei pool 0

adb logcat -s FarmShell FarmBridge
```

The Android toolchain needs JDK 17+ and the Android SDK (platform 35, build-tools 35). Set
`sdk.dir` in `android/local.properties` or `ANDROID_HOME`.

## How it works

- **Routes.** `scripts/generate-routes.mjs` reads the `RoutePattern` union that `farm generate`
  writes into `src/farm.d.ts` (so route groups and private folders follow Farm's scanner), orders
  static before dynamic segments, and applies `mobile.config.mjs`: tab roots become `tab`,
  `/notes/new` becomes `modal`, everything else `push`. A config entry that names no app route
  fails the script.
- **Link interception.** Farm's SPA router lives on `window.__FARM_SPA_ROUTER__`. The bridge
  script wraps `navigate()` when Farm installs it, so `<Link>` taps and `navigateTo()` post a
  `visit` message instead of navigating in place. Plain `<a>` document loads are caught in
  `shouldOverrideUrlLoading`. Other origins open in the browser.
- **Pool.** Two WebViews load `/notes` behind the opaque tab containers and count as warm once
  Farm's router is installed. A push takes a warm one, moves it into the new screen, and asks
  its running router to render the target (`navigate(url, { replace: true })`). The pool refills
  500 ms later so warming does not compete with the transition.
- **Modal.** `/notes/new` slides up over the tab bar. A push from inside the modal (the form's
  `navigateTo("/notes/:id")` after saving) dismisses it, refreshes the screen underneath with
  `router.refresh()`, and pushes the new note on the current tab.
- **Back.** One `OnBackPressedCallback` with predictive back: the top screen (or the modal)
  follows the gesture and commits or settles. Back from the second tab's root returns to the
  first tab; back on the first tab's root goes to the system (predictive back-to-home). WebView
  history never grows, so there is nothing for the WebView to go back through.
- **Bridge.** Messages in come through `WebViewCompat.addWebMessageListener`, scoped to the
  server origin and main frame (`addJavascriptInterface` with a URL check is the fallback).
  Replies go out with `evaluateJavascript("__farmBridge._resolve(id, ok, value)")`, only into a
  page on the app origin. `native.haptics.impact("light")` is a typed proxy over
  `__farmBridge.call()`; in a browser it falls back to `navigator.vibrate`, and rejects with
  `NativeUnavailableError` when there is no fallback.

## Findings

See the PR description for the run log, numbers and screenshots.
