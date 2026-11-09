---
title: "Mobile Apps"
description: "Ship the same Farm source as a native mobile app with farm dev --mobile and farm build --mobile."
section: "Runtime"
---

# Mobile Apps

Farm turns the app you already built for the web into a native mobile app. Your pages become the
screens, and Farm puts a native frame around them: tabs, a stack per tab, modal sheets, and the
system back gesture. You do not rewrite anything in another UI toolkit.

Every screen starts as your page in a WebView. Pages that need no JavaScript on the device can be
drawn with real native views instead, from the same `page.tsx`. For the few screens that need more,
you can add a React Native screen next to the page, one route at a time.

> **Preview.** The Android shell shipped in Farm 0.1.50 with `@farm.js/mobile`. The iOS shell,
> native screens, and React Native screens shipped in Farm 0.1.65 (`@farm.js/mobile`
> 0.1.0-beta.10). All of it runs on emulators and simulators in CI, not yet on physical devices. The design is [RFC 0004](https://github.com/farming-labs/farm.js/pull/2352),
> and how it works inside is in [How Farm draws a page natively](/blog/native-internals).

## Quick start

```sh
pnpm add -D @farm.js/mobile
```

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  mobile: ({ command }) => ({
    id: "com.example.notes",
    server: command === "dev" ? "http://10.0.2.2:3000" : "https://notes.example.com",
    tabs: [
      { path: "/notes", title: "Notes", icon: "note.text" },
      { path: "/settings", title: "Settings", icon: "gear" },
    ],
    routes: {
      "/notes/new": { presentation: "modal" },
    },
  }),
});
```

```sh
farm dev --mobile             # dev server, Android project, install and open on an emulator
farm dev --mobile --os ios    # the same, with the Xcode project on a booted simulator
farm build --mobile           # production Android project (--apk also builds the APK)
farm build --mobile --os ios  # production Xcode project
farm build                    # the web build, unchanged
```

| Option    | Notes                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| `id`      | Android application ID and iOS bundle ID, such as `com.example.notes`                             |
| `server`  | Your web deployment's origin. `https://`; `http://` only for loopback and LAN hosts in dev        |
| `name`    | Defaults to package.json `productName` or `name`                                                  |
| `tabs`    | At most 5. Each `path` is a static page route                                                     |
| `routes`  | Per route: `presentation` (`push`, `modal`, `replace`)                                            |
| `native`  | Which routes get native screens ([Native Screens](/docs/mobile/native-screens#choosing-a-screen)) |
| `shells`  | `true` bundles [page shells](/docs/mobile/shell#page-shells) for instant, offline-safe opens      |
| `modules` | Permissions and usage strings for device modules ([Device Features](/docs/mobile/modules))        |

The block can be an object or a function of `{ os, mode, command, profile, env, root }`, as
[`desktop`](/docs/desktop#function-valued-blocks) is. A web build never calls it and strips it from
the server. `farm config inspect --mobile` prints the resolved block and each route's screen.

## Three kinds of screen

| Screen           | Drawn with                                                 | Write                                             | Use it for                                 |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| **Web**          | a WebView of your page                                     | `page.tsx`, nothing else                          | everything, by default                     |
| **Native**       | Android views and UIKit, from the page your server renders | `page.tsx` that needs no JavaScript on the device | content, lists, detail pages, and forms    |
| **React Native** | a React Native surface                                     | `page.native.tsx`                                 | screens with state, gestures, or animation |

Every route keeps its `page.tsx`. It is the web page, and the fallback whenever a native screen
cannot show: a native screen that cannot draw some content, or a React Native screen that fails,
shows the web page instead. Native screens are covered in [Native Screens](/docs/mobile/native-screens),
and the WebView side in [The Web Shell](/docs/mobile/shell).

`page.kt` and `page.swift` (fully platform screens, no JavaScript) are planned and show a
placeholder for now.

## Status

| Part                                       | Status          | Verified on                                |
| ------------------------------------------ | --------------- | ------------------------------------------ |
| Android shell with web screens             | Shipped, 0.1.50 | Android emulator, in CI                    |
| `mobile` config and route manifest         | Shipped, 0.1.50 |                                            |
| iOS shell                                  | Shipped, 0.1.65 | simulator, in CI                           |
| Native screens drawn from `page.tsx`       | Shipped, 0.1.65 | Android emulator and iOS simulator, in CI  |
| Forms and server actions on native screens | Shipped, 0.1.65 | Android emulator; production server, in CI |
| React Native screens (`page.native.tsx`)   | Shipped, 0.1.65 | Android emulator and iOS simulator, in CI  |
| Device modules on React Native screens     | Shipped, 0.1.65 | Android emulator and iOS simulator, in CI  |
| `@farm.js/ui` on React Native screens      | Shipped, 0.1.65 | unit tests only                            |
| Signed-in native screens                   | Shipped, 0.1.65 | Android emulator under `farm dev --mobile` |
| Page shells (`mobile.shells`)              | Shipped, 0.1.65 | unit and generator tests only              |
| Platform screens (`page.kt`, `page.swift`) | Planned         |                                            |

Sign-in from the app is covered in [Authentication](/docs/auth#mobile-apps), and calling server
functions and API routes from React Native screens in
[Native Screens](/docs/mobile/native-screens#calling-your-server).

## Requirements

| For                  | You need                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Android              | JDK 17 or newer, and the Android SDK (platform 35, build-tools 35, platform-tools) with `ANDROID_HOME` set  |
| Running on Android   | An emulator or device with Android 8.0 (API 26) or newer, listed by `adb devices`                           |
| React Native screens | Also the Android NDK 27.1.12297006 and CMake 3.22.1, which Gradle installs on the first build               |
| iOS                  | A Mac with Xcode, the iOS 16 SDK or newer, and a simulator runtime; Command Line Tools alone are not enough |

## Run on Android

`farm dev --mobile` starts the dev server, writes the Android project into
`.farm/output/mobile/android` with the dev server as `server` (`http://10.0.2.2:<port>`, the host as
the emulator sees it), and installs and opens the app when `adb devices` lists an emulator or device
(`ANDROID_SERIAL` picks one). For a phone on your network, pass its address:
`farm dev --mobile --host 192.168.1.20`.

`farm build --mobile` makes the production build into `.farm/output/mobile/www`, writes the project
with `mobile.server`, and `--apk` builds a debug APK into `.farm/output/mobile/dist`. The project is
regenerated on every run, so don't edit it.

Plain `http://` is allowed only under `farm dev --mobile`. To test an APK against a server with a
local certificate, set `FARM_MOBILE_DEBUG_CA` to the PEM file of the CA that signed it; debuggable
builds trust it, release builds never do.

## Run on iOS

```sh
xcodebuild -downloadPlatform iOS   # the simulator runtime, once
open -a Simulator                  # boot a simulator
farm dev --mobile --os ios         # dev server, Xcode project, build and open on the simulator
farm build --mobile --os ios       # production Xcode project
```

`farm dev --mobile --os ios` points the app at `http://localhost:<port>` (the simulator shares the
Mac's network), writes the Xcode project into `.farm/output/mobile/ios`, and builds, installs and
opens it on a booted simulator. Farm builds simulator apps only: for an iPhone, open
`App.xcodeproj` in Xcode, set a signing team, and run it from there. The same signing team archives
for the App Store.

## In your pages

- **Hide web chrome the shell already draws.** The shell sets `data-farm-shell="android"` or
  `"ios"` on `<html>` before the page renders:

  ```css
  html[data-farm-shell] .web-tabs {
    display: none;
  }
  ```

- **Detect the app in effects, not in render.** `platform()` from `@farm.js/core/platform` is
  `"mobile"` inside the app, but pages render on your web server, where it is `"web"`. Branch in
  effects and event handlers so the page hydrates. See
  [Platform and app data](/docs/desktop#platform-and-app-data).
- **Links just work.** An in-app link becomes a native push; links to other origins open in the
  system browser sheet.
