---
title: "Desktop Apps"
description: "Build a native desktop app from the same Farm source with farm dev --desktop and farm build --desktop."
section: "Runtime"
---

# Desktop Apps

The same Farm app builds for the web or the desktop. With `--desktop`, the Farm production server
runs inside a desktop shell on `127.0.0.1`, and a native window shows it. Pages, server functions,
API routes, middleware, and local files work as they do on a server.

```sh
farm dev --desktop     # the app in its window, with HMR
farm build --desktop   # a packaged app
farm build             # --web, the default, unchanged
```

## Setup

Add `desktop` to the config and install `@farm.js/desktop` with the shell's toolkit:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  desktop: {
    name: "Notes",
    id: "com.example.notes",
    window: { width: 1100, height: 760 },
  },
});
```

```sh
pnpm add -D @farm.js/desktop electrobun
```

| Option          | Default                              | Notes                                                              |
| --------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `name`          | package.json `productName` or `name` | Display name                                                       |
| `id`            | `local.farm.<name>`                  | Reverse-DNS identifier. The OS keys the app's data directory on it |
| `version`       | package.json `version`               |                                                                    |
| `icon`          | the Farm icon                        | Square PNG relative to the app root; 1024×1024 recommended         |
| `window.width`  | `1024`                               | Points                                                             |
| `window.height` | `768`                                | Points                                                             |
| `window.title`  | `name`                               |                                                                    |
| `shell`         | `"electrobun"`                       | Resolves to `@farm.js/desktop/<shell>`, or a package name          |

A web build checks a static block's shape and otherwise ignores it: Farm removes `desktop` from
the config module a server bundle imports, so the output is byte-identical to the same app without
the key. `--desktop` fails with an actionable message when the key or the shell package is missing.

### Function-valued blocks

`desktop` can also be a function, sync or async, that returns the block:

```ts
export default defineConfig({
  desktop: async ({ os, mode, command, profile, env, root }) => ({
    name: profile === "beta" ? "Notes Beta" : "Notes",
    id: profile === "beta" ? "com.example.notes.beta" : "com.example.notes",
    window: { width: os === "macos" ? 1100 : 1200, height: 760 },
  }),
});
```

| Field     | Value                                           |
| --------- | ----------------------------------------------- |
| `os`      | `"macos"`, `"windows"`, or `"linux"` (the host) |
| `mode`    | `"development"` or `"production"`               |
| `command` | `"dev"` or `"build"`                            |
| `profile` | `--profile <name>`, `"production"` by default   |
| `env`     | a frozen snapshot of `process.env`              |
| `root`    | the app root                                    |

The function runs once when `farm dev --desktop` starts and once per `farm build --desktop`. A web
build never calls it. Only the values it returns reach the generated shell; the function and
anything it imports never ship, so it may read files, call the network, or use `env`. The returned
block is validated with errors that name the OS and field, such as
`desktop (os: windows): window.width must be a whole number of points between 100 and 16384.`

```sh
farm build --desktop --profile beta
farm config inspect --desktop --os windows --profile beta   # prints the resolved block
```

## Platform and app data

```ts
import { join } from "node:path";
import { appDataDir, platform } from "@farm.js/core/platform";

if (platform() === "desktop") {
  const file = join(appDataDir(), "notes.json");
}
```

`platform()` returns `"web"` or `"desktop"`. In browser code it is replaced with a literal at build
time, so `platform() === "desktop"` branches fold away.

| Mode                 | `appDataDir()`                                              |
| -------------------- | ----------------------------------------------------------- |
| packaged desktop app | the OS user data directory for `desktop.id`, created on use |
| `farm dev --desktop` | `.farm/data/desktop`                                        |
| web                  | `FARM_DATA_DIR` when set, otherwise it throws               |

`appDataDir()` is server-only. Never write next to the app's code: a packaged app is read-only and
signed.

## The local guard

Any local process and any page in the user's browser can reach `127.0.0.1`, so desktop builds and
`farm dev --desktop` answer only their own window:

- The shell starts the server with a per-launch secret and a one-time handshake token, then opens
  the window at `/__farm/desktop/handshake?t=<token>`. The handshake consumes the token, sets the
  secret as an `HttpOnly`, `SameSite=Strict` cookie named `farm_desktop`, and redirects to `/`.
- Every request needs that cookie, compared in constant time: pages, API routes, server functions,
  plugin endpoints, Farm's built-in endpoints, client assets, and WebSocket upgrades. In dev it also
  covers Vite's module requests.
- `Host` must be `127.0.0.1`, `localhost`, or `[::1]` on the server's port, which blocks DNS
  rebinding. Requests that Fetch Metadata marks `cross-site` or `same-site` (a page on another
  localhost port) are rejected, and unsafe methods with an `Origin` must come from the server's
  own origin.

The guard runs before plugins, middleware, and routing, and is not configurable. Web builds do not
contain it. It protects the HTTP surface, not the disk: code running as the same OS user can read
the app's data files directly.

## Desktop defaults

A desktop app is not a public site. Unless the config sets them, desktop builds turn off:

- `agent.sitemap`, `agent.llmsTxt`, `agent.manifest`, `agent.aiCatalog`, and the default `/mcp`
  server (`agent.mcp`): no agent could reach them through the guard;
- `agent.jsonLd`;
- image optimization (`images.provider` becomes `"none"`, which keeps sharp's native binaries out of
  the app).

## Output

```text
.farm/output/desktop/
  server/   Farm server for the shell's runtime; server/index.mjs exports start()
  shell/    generated shell main process and config (regenerated on every build)
  dist/     the packaged app
```

The server is the `bun` preset, or `node-server` for shells that embed Node. `HOST` and `PORT` in
the environment do not apply: the server binds `127.0.0.1` on a port the OS assigns.

## Electrobun

`@farm.js/desktop/electrobun` is the default shell. It generates `electrobun.config.ts` and the
main process into `.farm/output/desktop/shell` on every run, embeds the Farm server in Electrobun's
Bun, and uses the system WebView (WKWebView on macOS), so no Chromium ships with the app.

- `farm dev --desktop` runs `electrobun dev` with the window on `farm dev`.
- `farm build --desktop` runs `electrobun build --env=stable` and moves the app to
  `.farm/output/desktop/dist`, with update archives in `dist/update`.
- `appDataDir()` is Electrobun's `Utils.paths.userData`, for example
  `~/Library/Application Support/<desktop.id>/stable` on macOS.
- Quitting the app drains requests and runs Farm's shutdown hooks before the process exits.
- The window is sandboxed: page scripts and frames get no Electrobun RPC bridge.
- `desktop.icon` (or the Farm icon) becomes the app's `AppIcon.icns` on macOS.
- Known limit: the first launch after an install or update leaves Electrobun's hidden unpacking
  process running until logout. Later launches don't.

The first `electrobun` command downloads Hutch and the Electrobun runtime into `~/.hutch`. The
packaged app ships its own Bun. Measured on macOS 26, Apple silicon, with
`examples/desktop-electrobun`: a 32 MB `.app` (94 MB after the first launch unpacks it, 85 MB of it
Bun) and a 3.1 MB server.

Optional hooks run in the shell process:

```ts
// src/desktop.ts
import { defineDesktop } from "@farm.js/core/desktop";

export default defineDesktop({
  onReady({ window, server, mode }) {
    console.log(`Notes on ${server.origin} (${mode})`);
  },
});
```

## Shell adapters

`@farm.js/desktop` ships the built-in shells as subpaths (`@farm.js/desktop/electrobun`). Any other
shell is a package, or a package subpath, whose default export implements `DesktopShell` from
`@farm.js/core/desktop`; set `desktop.shell` to its name:

```ts
import { defineDesktopShell } from "@farm.js/core/desktop";

export default defineDesktopShell({
  name: "my-shell",
  runtime: "bun",
  generateMain(context) {
    return [{ path: "main.ts", contents: "..." }];
  },
  async dev(context) {
    // Open a window on context.devUrl at the handshake URL.
    return { exited, close };
  },
  async package(context) {
    return { files: [] };
  },
});
```

A Bun or Node shell imports the server in-process:

```ts
const { start } = await import("./server/server/index.mjs");
const server = await start({ secret, handshakeToken, dataDir });
// server.origin, server.port; await server.stop() drains requests and runs shutdown hooks.
```

A shell that runs the server as its own process sets `FARM_DESKTOP_SECRET`,
`FARM_DESKTOP_HANDSHAKE_TOKEN`, and `FARM_DESKTOP_DATA_DIR`, runs `server/index.mjs`, and waits for
the line `farm:ready {"port":N}` on stdout.

## Mobile (preview)

`mobile` wraps the app in a native Android shell: native tabs, a stack per tab, modal sheets, and
predictive back, with each screen showing one Farm page in a WebView. The block takes the same
static or function form as `desktop`, with `os` set to `"android"` or `"ios"`:

```ts
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

Tabs and route keys are checked against the app.

```sh
farm config inspect --mobile --os ios --profile beta   # block, screens, and farm-routes.json
```

### Screens

Every route is a screen in the app's native navigator. A screen is one of three tiers:

- `web`, the default: the route's `page.tsx` in a WebView.
- `native`: a React Native screen from `page.native.tsx`.
- `platform`: a Compose screen from `page.kt` on Android or a SwiftUI screen from `page.swift` on
  iOS.

No native engine ships yet; the tier is recorded in `farm-routes.json` for the shell.

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
`page.native.tsx` (or OS file); without one the route stays web with a warning, and once native
screens ship it fails the build. `screen: "platform"` needs `page.kt` or `page.swift`. Set
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

### Native screen report

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
screen until native screens ship. Results are cached by file content in `.farm/cache/mobile/`.

#### Breaking change from the first preview

`mobile.routes[route].native: "<module>"` is gone; `src/native/` is reserved for native module
specs. Add `page.native.tsx` next to the route's `page.tsx`, or set
`native: { routes: { "/feed": { screen: "native" } } }`. The old form fails with that message.

### Route manifest

The navigator manifest, `farm-routes.json`, has one rule per page route in the client router's
order, with the base path and optional locale prefixes in each pattern, and each rule's `screen`,
`source`, and `module`. A web build never calls or checks the block and strips it like `desktop`.
`platform()` returns `"mobile"` only in the app's client build; its pages render on the web
deployment, whose server reports `"web"`, so don't branch render output on it.

### Run on Android

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
`mobile.server`, prints the native screen report (below) unless `native.auto` is `"off"`, and
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

Current limits:

- Android only. There is no iOS shell yet.
- `native` and `platform` screens show a placeholder that names the route's module id, such as
  `app/notes/[id]`. Farm does not build `page.native.tsx`, `page.kt`, or `page.swift` yet;
  `FarmNativeScreens` in the generated project is where native screens register.
- The shell loads pages and client code from `server`. In production that is the web deployment,
  whose client is not a `--mobile` build, so navigations stay in the page until client assets are
  bundled into the app.
- No token auth: the shell has no Keystore session or bearer tokens, and the server has no
  mobile-origin checks.
- `farm dev --mobile` writes `farm-routes.json` once; routes added while it runs use the default
  push rule until the next start. Server code in the dev server sees `platform()` as `"mobile"`.
- Apps with `experimental.serverComponents` use the RSC router, which does not hand navigations to
  the shell yet.
