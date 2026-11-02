---
title: "Mobile Apps"
description: "Ship the same Farm source as a native mobile app with farm dev --mobile and farm build --mobile."
section: "Runtime"
---

# Mobile Apps

The same Farm app that builds for the [web](/docs/deployment) or the [desktop](/docs/desktop) can
also build for mobile. `mobile` wraps the app in a native shell: native tabs, a stack per tab,
modal sheets, and predictive back, with each screen showing one Farm page in a WebView.

Mobile is a preview and is not released yet. Android runs today; the iOS shell and the native
screen engines are in progress. Each section below marks what ships now and what is still landing,
so you can adopt the config surface before the runtime is complete.

```sh
farm dev --mobile      # dev server, Android project, install and open on a device
farm build --mobile    # mobile client build and Android project
farm build             # --web, the default, unchanged
```

## Setup

Install the shell package and add a `mobile` block to the config. The block takes the same static
or function form as [`desktop`](/docs/desktop#function-valued-blocks), with `os` set to `"android"`
or `"ios"`:

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
    native: {
      routes: {
        // Keep Android on the web screen while its native screen is in progress.
        "/feed": { screen: "native", android: "web" },
      },
    },
  }),
});
```

| Option   | Notes                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------- |
| `name`   | Defaults to package.json `productName` or `name`                                                |
| `id`     | Android application ID and iOS bundle ID: letters and digits per segment, such as `com.a.notes` |
| `server` | Origin of the web deployment. `https://`; `http://` only for loopback and LAN hosts in dev      |
| `tabs`   | At most 5. Each `path` is a static page route                                                   |
| `routes` | Keyed by page route pattern: `presentation` (`push`, `modal`, `replace`)                        |
| `native` | Screen tiers per route, the native engine, and the analyzer (below)                             |

Tabs and route keys are checked against the app. A web build checks the block's shape and otherwise
strips it, exactly as it does `desktop`, so the web output is byte-identical to the same app
without the key.

```sh
farm config inspect --mobile --os ios --profile beta   # block, screens, and farm-routes.json
```

## Screens

Every route is a screen in the app's native navigator. A screen is one of three tiers:

- `web`, the default: the route's `page.tsx` in a WebView.
- `native`: a React Native screen from `page.native.tsx`.
- `platform`: a Compose screen from `page.kt` on Android or a SwiftUI screen from `page.swift` on
  iOS.

The native engines are in progress. The tier is recorded in `farm-routes.json` for the shell, and
every analyzed route renders as a web screen until the engines land.

A screen is declared by the file you place next to `page.tsx`, or by `mobile.native.routes`.
`src/native/` is reserved for native module specs.

```text
src/app/feed/
  page.tsx            web page, mobile web screen, and the fallback (required)
  page.native.tsx     React Native screen on iOS and Android
  page.ios.tsx        replaces page.native.tsx on iOS
  page.android.tsx    replaces page.native.tsx on Android
  page.kt             platform screen on Android
  page.swift          platform screen on iOS
  layout.native.tsx   reserved for native stack and tab options
```

A native file without a `page.tsx` next to it is an error, and so is a React Native and a platform
file for the same route and OS. Web and desktop builds never read these files: they are not
routes, not in the generated route types, and not in any web bundle.

A page can set its own options with a static export, read at build time without running the page:

```tsx
// src/app/notes/[id]/page.tsx
import type { FarmMobilePageConfig } from "@farm.js/core/mobile";

export const mobile = { presentation: "modal", prefetch: "off" } satisfies FarmMobilePageConfig;
```

`presentation` and `prefetch` (`"intent"` or `"off"`) override the config for that route.
`native: false` keeps the route web on every OS, whatever the config and files say. The values
must be literals.

`mobile.native`:

| Option     | Notes                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `engine`   | `"react-native"` (default) or `"platform"`. With `"platform"`, `.native.tsx` files are an error |
| `auto`     | The build-time analyzer: `"off"`, `"report"` (default), or `"on"` (records ports, see below)    |
| `routes`   | Keyed by page route: `screen` (`web`, `native`, `platform`), `android`, `ios`, `presentation`   |
| `islands`  | Components that may render natively inside web screens, such as `["Map"]`. Reserved             |
| `prefetch` | `"intent"` (default) or `"off"`                                                                 |
| `budgets`  | `appSizeMb`, `screenOpenMs`, `droppedFrames`. Reserved for the mobile CI run                    |

`android` and `ios` override `screen` on that OS. `screen: "native"` uses the route's
`page.native.tsx` (or OS file); without one the route stays web with a warning, and once the native
engines land it fails the build. `screen: "platform"` needs `page.kt` or `page.swift`. Set
`presentation` in `routes` or `native.routes`, not both.

For each route and OS, the first source that decides wins:

1. the page export (`native: false`);
2. `mobile.native.routes[route]`, the OS key and then `screen`;
3. the files next to `page.tsx`: the OS file, then `page.native.tsx`, or `page.kt` / `page.swift`;
4. the analyzer, when `auto` is `"on"`;
5. web.

`farm config inspect --mobile` prints each route's `screen`, the `source` that decided it (`page`,
`config`, `file`, `analyzer`, or `default`), and a warning when a page export overrides config or
a native file goes unused. Native routes get a `module` id derived from the route, such as
`app/notes/[id]`.

## Native screen report

The analyzer finds pages a native screen could replace without changes. It is report only: it
changes no output, and every analyzed route stays a web screen.

```sh
farm config inspect --mobile --report   # table, plus .farm/output/mobile/native-report.json
```

```text
route        screen  decision  mapped  portable  reason
/feed        native  -                           src/app/feed/page.native.tsx
/notes       web     port      12/12   100%      portable; input, list
/notes/[id]  web     web       9/10    90%       src/app/notes/[id]/page.tsx:41:9 dangerouslySetInnerHTML
/settings    web     web       18/18   100%      portable; no win (18 elements)
```

It looks at each page that no page export, config route, or screen file decided, plus config
routes that ask for `screen: "native"` without a file. For each one it parses the page, its app
modules, and the layouts a `layout.native.tsx` does not replace, and classifies every JSX element,
class name, inline style, browser API and import:

- Ports: `div`, `section`, `p`, `span`, headings, `img`, `a`, `button`, text `input`, `textarea`,
  `ul`, `ol`, `li`; `@farm.js/ui` and `@farm.js/native`; `Link`, navigation hooks, and server
  function hooks from `@farm.js/core`; flex, spacing, size, color, border, radius and type
  classes from Tailwind, with `dark:`; inline styles with those properties; `onClick`, and
  `onChange` on inputs; server function modules, which the screen calls over the network.
- Blocks, so the route stays web: `canvas`, `iframe`, `video`, `table`, `svg`, `select`, `form`;
  `dangerouslySetInnerHTML`, refs on elements, spread props on elements, other DOM events;
  stylesheet imports, grid, `fixed` and `sticky`, transitions, responsive and `hover:` variants,
  arbitrary values, class names built at runtime; `window`, `document`, storage and observer APIs,
  `useLayoutEffect`, `createElement`; DOM packages and any package not on the list; server
  components and async pages; Markdown pages.

A portable route is `port` when native would help (a rendered list, a controlled input, a timer)
and `web` otherwise. Every web route lists its blockers with file, line, column and rule in the
JSON, which also holds element counts and a small UI tree (`ir`) for portable routes. With
`auto: "on"` a `port` is recorded in `farm-routes.json` as `source: "analyzer"`, still a web
screen until the native engines land. Results are cached by file content in `.farm/cache/mobile/`.

## Route manifest

The navigator manifest, `farm-routes.json`, has one rule per page route in the client router's
order, with the base path and optional locale prefixes in each pattern, and each rule's `screen`,
`source`, and `module`. A web build never calls or checks the block and strips it like `desktop`.

## Platform detection

`platform()` from `@farm.js/core/platform` returns `"mobile"` only in the app's client build. Its
pages render on the web deployment, whose server reports `"web"`, so don't branch render output on
it. See [Platform and app data](/docs/desktop#platform-and-app-data) for how `platform()` folds to
a literal at build time.

## Run on Android

Install the shell package and the Android toolchain (JDK 17 or newer, and the Android SDK with
platform 35, build-tools 35, and platform-tools; set `ANDROID_HOME`):

```sh
pnpm add -D @farm.js/mobile
farm dev --mobile                  # dev server, Android project, install and open on a device
farm build --mobile                # mobile client build and Android project
farm build --mobile --apk          # also ./gradlew assembleDebug
```

`farm dev --mobile` starts the dev server with a `--mobile` client build, writes
`farm-routes.json` with the dev server as `server` (`http://10.0.2.2:<port>`, the host's loopback
as the Android emulator sees it), and generates the Gradle project into
`.farm/output/mobile/android`. When `adb devices` lists an emulator or device, it runs
`./gradlew installDebug` and opens the app (`ANDROID_SERIAL` picks one of several); otherwise it
prints the commands. For a phone on the LAN, pass its reachable address: `farm dev --mobile --host
192.168.1.20`.

`farm build --mobile` builds the client with `platform()` set to `"mobile"` into
`.farm/output/mobile/www` (the web build's output is left alone), writes `farm-routes.json` with
`mobile.server`, prints the native screen report above unless `native.auto` is `"off"`, and
generates the project. `--apk` builds the debug APK into
`.farm/output/mobile/dist`. The project is regenerated on every run, so don't edit it.

| Path                                     | Contents                                               |
| ---------------------------------------- | ------------------------------------------------------ |
| `app/src/main/assets/farm-routes.json`   | The navigator manifest                                 |
| `app/src/main/assets/farm-bridge.js`     | Bridge script injected into pages on the server origin |
| `app/src/main/java/.../Navigator.kt`     | Tabs, stacks, push, modal, replace, predictive back    |
| `app/src/main/java/.../WebViewPool.kt`   | Two pre-warmed WebViews that back pushes               |
| `app/src/main/java/.../NativeScreens.kt` | The hook for `native` and `platform` screens           |

In the shell, a `--mobile` client hands each in-app navigation (`Link`, `navigateTo`, router
`push` and `replace`) to the navigator through [`delegateNavigation`](/docs/routing#navigation-delegates),
which pushes, presents, or switches tabs by the matching rule. Link prefetch is off inside the
shell, since every screen has its own WebView. Links to other origins open in Custom Tabs.

The shell marks each page with `data-farm-shell="android"` on `<html>` before it renders, so app
CSS can hide chrome the shell already draws, such as web tabs:

```css
html[data-farm-shell] .web-tabs {
  display: none;
}
```

## What is landing

The config surface above is in place. These parts are still on the way:

- Android runs today; there is no iOS shell yet.
- `native` and `platform` screens show a placeholder that names the route's module id, such as
  `app/notes/[id]`. Farm does not build `page.native.tsx`, `page.kt`, or `page.swift` yet;
  `FarmNativeScreens` in the generated project is where native screens will register.
- The shell loads pages and client code from `server`. In production that is the web deployment,
  whose client is not a `--mobile` build, so navigations stay in the page until client assets are
  bundled into the app.
- Token auth is not wired yet: the shell has no Keystore session or bearer tokens, and the server
  has no mobile-origin checks.
- `farm dev --mobile` writes `farm-routes.json` once; routes added while it runs use the default
  push rule until the next start. Server code in the dev server sees `platform()` as `"mobile"`.
- Apps with `experimental.serverComponents` use the RSC router, which does not hand navigations to
  the shell yet.
