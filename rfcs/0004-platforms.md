# RFC 0004: Platforms: one Farm source for web, desktop and mobile

- Status: Draft
- Target: 0.2
- Tracking issue: none yet
- Scope: `@farm.js/core` build and server runtime, `@farm.js/cli`, new optional packages for desktop
  shells, `@farm.js/mobile`, `@farm.js/ui` and `@farm.js/native`. Desktop, web, mobile web
  screens and platform screens (which run no JS) work with every renderer. React Native screens,
  `@farm.js/ui` and the build-time analyzer are React only.

## Status

Updated 2026-11-06, after 0.1.60.

- Desktop: merged and released. #2353 (core runtime primitives), #2354
  (`farm dev|build --desktop`), #2355 (Electrobun adapter), #2356 (config-only desktop example),
  #2407 (the adapter as `@farm.js/desktop/electrobun`). Run on macOS only.
- Mobile, released through 0.1.60 (2026-11-05) as a preview, with `@farm.js/mobile` 0.1.0-beta.5
  and `@farm.js/native` 0.1.0-beta.2:
  - Web screens (phase 5): `farm dev --host` (#2418), `delegateNavigation` (#2419), the `mobile`
    block and `farm-routes.json` (#2420), the Android shell with `farm dev|build --mobile [--apk]`
    (#2422), `data-farm-shell` and `examples/mobile` (#2427).
  - Production web screens (phase 6): bundled client assets (#2472), page shells (#2496), device
    tokens for signed-in native screens (#2470), the mobile client for server components apps
    (#2493), and the iOS shell, `farm dev|build --mobile --os ios` (#2441).
  - React Native screens (phase 8): the `mobile.native` block and screen files (#2424),
    `@farm.js/native` with Metro and Hermes builds (#2444), the React Native host in the Android
    shell (#2445), the example's `/map` and `/camera` (#2446), `@farm.js/auth/client` on native
    screens (#2503) with native sign-in and sign-up (#2507), and the app's typed API client.
  - Native modules (phase 7): installed React Native modules are autolinked (#2523), app
    TurboModules from `src/native/` with `mobile.modules` permissions (#2524), and web screens
    call modules that opt in (#2528).
  - The analyzer (phases 8 and 10): tiers and `export const mobile = { native: true }` (#2473),
    native-tier pages drawn by the Android shell from the page the server renders (#2474, #2478,
    #2481, #2505), and generated React Native ports of portable pages.
- Merged after 0.1.60, not released: server functions called by import from native screens.
- Mobile, in review:
  - #2556: a CI job that builds the generated iOS project with `xcodebuild` and runs it on an
    iPhone simulator. Its first run (Xcode 16.4) is the first time the iOS shell was built and
    launched. #2557 fixes the one bug that run found, tab titles replaced by page titles.
  - #2495: native-tier pages drawn with UIKit on iOS.
  - #2545: `@farm.js/ui` rendered as React Native views on native screens and in generated ports.
  - The Android spike #2390 stays a draft.
- Verified on an Android 15 emulator: tabs, push, modal and back; React Native screens under
  `farm dev --mobile` and from a Hermes bytecode build; the web twin replacing a native screen
  that fails to start; an installed module (`netinfo`) and an app module in an APK; calls from a
  web screen to an app module; the production path for bundled client assets; the device token
  flow (session, bearer, refresh, revoke, Keystore across a restart); native-tier server screens
  and a generated port under `farm dev --mobile`.
- Verified on an iOS simulator: the production project builds, and the dev app launches and shows
  the home web screen. Nothing else on iOS has run.
- Not verified anywhere: a physical device; a release APK with R8; native sign-in (#2507) and page
  shells (#2496) on an emulator or simulator; desktop on Windows and Linux.
- Not built: the iOS React Native host (native screens, modules and ports are Android only),
  platform screens (`page.kt`, `page.swift`), native islands, file references and subscriptions
  for module calls, `layout.native.tsx` providers, intent prefetch, budgets in CI, the contract
  manifest and the remote rule override.
- Revised 2026-11-01: mobile screens come in tiers chosen per route (web by default, React Native
  or platform native), `page.native.tsx` selects a native screen, a `mobile.native` config block
  and an optional build-time analyzer decide the rest, and native islands are narrowed to large
  fixed components. This replaces the 2026-10-29 rule that shared components are always native
  islands on mobile.
- Revised 2026-11-02: implementation decisions for React Native screens and the iOS shell are
  recorded in [Decisions since the 2026-11-01 revision](#decisions-since-the-2026-11-01-revision).

## Summary

One Farm app source builds three outputs:

```sh
farm build            # --web, the default, unchanged
farm build --desktop  # a native desktop app with its own local server
farm build --mobile   # an iOS and Android app: native navigator, Farm pages or native screens
```

The flag decides where the server runs:

| Flag        | Server runs                                 | Client                               |
| ----------- | ------------------------------------------- | ------------------------------------ |
| `--web`     | on the host (`deploy.target`, Nitro preset) | browser                              |
| `--desktop` | inside the app, on `127.0.0.1`              | system WebView in a desktop shell    |
| `--mobile`  | remote: a `--web` deployment or managed     | native chrome, web or native screens |

Platform behavior is configured with `desktop: {}` and `mobile: {}` in `farm.config.ts`, not with
plugins. Native projects and shell code are generated into `.farm/` on every build and can be
ejected into the repo with `farm eject desktop|mobile`. Apps that never use `--desktop` or
`--mobile` ship no platform code in their bundles.

## Motivation

Farm apps already have the pieces a native app needs: SSR, server functions, typed routes, local
storage primitives and a production server that runs on Bun or Node. What they lack is a supported
way to put that app on a desktop or a phone without rewriting it.

The Electrobun spike (#2303) proved the desktop half works with no core changes: the
`farm build --preset bun` output runs unmodified inside Electrobun's bundled Bun. SSR, API routes,
server functions and `node:fs` run in Bun; WKWebView displays the result and hydrates the client.
It also needed about
270 lines of example glue that every desktop app would copy:

- a dev script that runs `farm dev` and the shell together;
- a shell main process that reserves a port, releases it, then starts the server on it (a race);
- a `desktopGuard()` plugin with a per-launch secret, a handshake route, a cookie check and a Host
  check, because any local process or web page could otherwise call the server;
- data directory plumbing through environment variables;
- config overrides to drop public-site features (`images.provider: "none"`, agent routes off).

Measured on macOS 26, Apple silicon: the packaged `.app` is a 34 MB download and 106 MB after the
first-launch extraction (85 MB of it is Bun). The server output was 15 MB before the size fixes
in PRs #2304 (skip `@vercel/og` when unused) and #2316 (keep the dev pipeline out of runtime
plugin servers). Dev kept HMR because the window loads `farm dev`.

Farm should own that glue. Mobile is a different shape (the server cannot run on the phone), but
the same principle applies: the app source stays one Farm app, and the platform is a build output.

## Goals

- One source builds `--web`, `--desktop` and `--mobile`. No per-platform redevelopment is required
  for the default result.
- `--web` output and behavior are unchanged.
- Nothing platform-specific ships in the core bundles of apps that do not build for that platform.
- Desktop is secure by default: the local server is reachable only from its own window.
- Mobile apps feel native where users notice (navigation, chrome, pickers, lists) and stay Farm
  pages everywhere else.
- Mobile apps pay only for what they use: a native engine is in the app only when a route needs
  it, and every native screen keeps a web fallback.
- Generated by default, ejectable when an app needs full control.

## Non-goals

- Running the Farm server on the phone.
- Converting arbitrary React DOM to native views. The analyzer (7.8) ports only routes it proves
  portable; everything else stays web.
- A Farm-owned native UI toolkit. `@farm.js/ui` maps to React Native and platform views; it does
  not draw its own.
- Downloading native screen code after install.
- Publishing to app stores. Farm produces signed-ready artifacts; store submission stays with the
  platform tools.

## 1. Config, not plugins

Platforms are top-level config keys. They change build outputs, server defaults and CLI behavior,
which is config's job; a plugin would have to reach into all three.

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  desktop: {
    name: "Notes",
    window: { width: 1100, height: 760, minWidth: 720 },
    shell: "electrobun", // optional, see 6.6
  },
  mobile: {
    id: "dev.farmjs.notes",
    name: "Notes",
    server: "https://notes.example.com", // omitted: managed hosting, see 7.14
    tabs: [
      { path: "/notes", title: "Notes", icon: "note.text" },
      { path: "/settings", title: "Settings", icon: "gear" },
    ],
    routes: {
      "/notes/new": { presentation: "modal" },
    },
    native: {
      engine: "react-native",
      auto: "report",
      routes: {
        "/feed": { screen: "native" },
        "/map": { screen: "platform", ios: "web" },
      },
      islands: ["Video"],
      prefetch: "intent",
      budgets: { appSizeMb: 40, screenOpenMs: 300, droppedFrames: 2 },
    },
    components: { select: "native", datePicker: "native", menu: "native" },
    modules: {
      camera: { usage: "Attach photos to notes." },
      biometrics: { usage: "Unlock your notes." },
    },
  },
});
```

`mobile.native` decides which routes get native screens (7.3); `mobile.modules` enables native
modules and their permission strings (7.5).

Both keys are optional. Their types live in core so `defineConfig` checks them, but their
implementations load only when the matching flag is passed.

### 1.1 Static or dynamic blocks

`desktop` and `mobile` take either a static object or a function that returns one, sync or
async. The function receives the platform context once; every field inside the returned object
is a plain value that can use that context through the closure.

```ts
type Configurable<C, T> = T | ((context: C) => T | Promise<T>);

interface MobileContext {
  os: "ios" | "android";
  mode: "development" | "production";
  command: "dev" | "build";
  profile: string; // farm build --mobile --profile beta, default "production"
  env: Readonly<Record<string, string | undefined>>;
  root: string;
}

interface DesktopContext extends Omit<MobileContext, "os"> {
  os: "macos" | "windows" | "linux";
}

interface FarmUserConfig {
  desktop?: Configurable<DesktopContext, FarmDesktopConfig>;
  mobile?: Configurable<MobileContext, FarmMobileConfig>;
}
```

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const notesTab = { path: "/notes", title: "Notes", icon: "note.text" };
const searchTab = { path: "/search", title: "Search", icon: "magnifyingglass" };
const settingsTab = { path: "/settings", title: "Settings", icon: "gear" };

export default defineConfig({
  mobile: async ({ os, command, profile, env, root }) => ({
    id: profile === "beta" ? "dev.farmjs.notes.beta" : "dev.farmjs.notes",
    server: command === "dev" ? "http://192.168.1.20:3000" : "https://api.notes.app",
    tabs: os === "android" ? [notesTab, searchTab, settingsTab] : [notesTab, settingsTab],
    native: { routes: { "/feed": { screen: os === "android" ? "native" : "web" } } },
    modules: {
      push: os === "ios" ? { apnsKeyId: env.APNS_KEY_ID } : { firebase: "./google-services.json" },
    },
    version: JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
  }),
});
```

Rules:

- The function runs at build time, and when `farm dev` starts or restarts, once per target OS
  (`farm build --mobile` resolves `ios` and `android` separately). Only the resolved values reach
  the generated output; the function never ships, so it may use `fs`, network calls and `env`.
- Fields inside the block are plain values. Real callbacks (`onReady`, menu actions, bridge
  handlers) live in `src/desktop.ts` and `src/mobile.ts`, so nothing in the block is ambiguous.
- Resolved values are validated with errors that name the OS and field, for example
  `mobile (os: android): tabs[2] must be a route path`. A `--web` build does not call the
  functions but still type-checks the keys.
- Secrets come from `env`; signing identities and keys are never literals in the config file.
- `farm config inspect --mobile --os ios --profile beta` prints the resolved block.
- Values that must change without a new build or store release (feature flags, minimum app
  version) are runtime config served by the app's server, not part of these blocks.

## 2. CLI flags

```sh
farm dev --desktop      farm build --desktop
farm dev --mobile       farm build --mobile
farm dev --web          farm build --web       # same as no flag
farm eject desktop      farm eject mobile
```

The flags are mutually exclusive. The name is not `--platform`: deploy code and `farm deploy`
already use "platform" for hosting providers (`FarmDeployPlan["target"]`), and reusing it for
web/desktop/mobile would make both meanings ambiguous.

`--desktop` and `--mobile` fail with an actionable error when the config key is missing, when the
shell package is not installed, or (mobile) when Xcode or the Android SDK is absent for the
requested output.

## 3. `platform()` and build-time constants

```ts
import { platform } from "@farm.js/core/platform";

if (platform() === "desktop") {
  // only in desktop builds
}
```

`platform()` returns `"web" | "desktop" | "mobile"`. In client code it is replaced with a literal at
build time, so dead branches are removed. On the server it reads the platform the server was built
for, because one server build can be reused by tests and tooling; a literal there is a later
optimization. In `--mobile` builds the server
is a web deployment, so server code sees `"web"` and client code inside the app sees `"mobile"`.
The client also gets `data-platform="web|desktop|mobile"` on `<html>` for CSS (not in the first
desktop implementation).

## 4. Generated by default, ejectable

Native projects and shell code are generated into `.farm/` on every build, the way Expo's
continuous native generation works. Users do not commit them and Farm upgrades update them.

```text
farm build --desktop                        farm eject desktop
.farm/output/desktop/shell/  (regenerated)  desktop/  (committed, never overwritten)
```

`farm eject desktop|mobile` copies the generated project (`.farm/output/desktop/shell`,
`.farm/output/mobile/ios` and `android`) into the repo (`desktop/`, `mobile/ios`,
`mobile/android`). After ejecting, Farm still builds the server and web assets but no longer
touches the native project; it prints a diff hint when its template changed on upgrade.

Before ejecting, apps customize behavior through optional hook files:

```ts
// src/desktop.ts
import { defineDesktop } from "@farm.js/core/desktop";

export default defineDesktop({
  menu: [
    {
      label: "File",
      items: [{ label: "New note", accelerator: "CmdOrCtrl+N", route: "/notes/new" }],
    },
  ],
  tray: { icon: "./assets/tray.png", items: [{ label: "Quit", role: "quit" }] },
  onReady({ window, server }) {
    window.setTitle(`Notes (${server.origin})`);
  },
});
```

`src/mobile.ts` uses `defineMobile` for launch hooks, deep link handling and push registration.
Hook files run in the shell process (desktop) or are compiled into the native project's startup
(mobile through the bridge). They never enter the web client bundle.

## 5. Low bloat

- Desktop server entry, guard, shell templates and mobile generator are separate modules loaded
  only by `--desktop` or `--mobile` builds.
- Inside a mobile app, React Native (Hermes, Fabric, the shared runtime) is present only when a
  route resolves to a React Native screen, an island's native view only when the island is listed
  in `mobile.native.islands`, and module glue only for enabled modules. The analyzer runs only in
  `farm build --mobile`.
- Shell adapters are separate optional packages (`@farm.js/desktop-electrobun`,
  `@farm.js/desktop-electron`, `@farm.js/desktop-tauri`).
- `@farm.js/core/native`, `@farm.js/ui` and `@farm.js/native` are only in the graph when imported.
- A `--web` build of an app with a `desktop` or `mobile` config key produces byte-identical output
  to the same app without the key, when the app's config file is not bundled into the server. Apps
  whose config is bundled (for example apps with runtime plugins) only add the bytes of their own
  `desktop: {...}` or `mobile: {...}` literal. A function-valued block is never called by a web
  build. This is a required test.

## 6. Desktop

### 6.1 Shape

```text
+---------------------------- Notes.app ----------------------------+
|  shell main (Bun)                                                 |
|    start() --> Farm server on 127.0.0.1:<port 0>  (same process)  |
|    open window --> /__farm/desktop/handshake?t=<one-time token>   |
|                                                                   |
|  +---------------- system WebView window ----------------------+  |
|  |  Farm page, hydrated as on web, cookie-authenticated        |  |
|  +-------------------------------------------------------------+  |
|  appDataDir(): ~/Library/Application Support/<app>/               |
+-------------------------------------------------------------------+
```

The server is the normal Farm production server built for Bun (or Node for shells with
`runtime: "node"`). Desktop apps keep SSR, server functions, API routes, middleware and local
files.

### 6.2 Server entry

Farm owns the desktop server entry. It binds port 0 and reports the port the OS assigned, so there
is no reserve-then-release race:

```ts
// .farm/output/desktop/server/server/index.mjs (generated, Nitro's server layout)
export async function start(options: {
  dataDir: string;
  secret: string;
  handshakeToken: string;
}): Promise<{ origin: string; port: number; stop(): Promise<void> }>;
```

Bun shells import `start()` in-process. Node shells do the same with the Node runtime. Sidecar
shells (Tauri) run the entry as a child process that prints one ready line,
`farm:ready {"port":53122}`, on stdout; the shell waits for that line, not for a timeout.

`stop()` drains in-flight requests and runs Farm's shutdown hooks before the shell exits.

### 6.3 Local guard

The guard is built into the server runtime and compiled only into desktop builds. Web builds do not
contain it.

```mermaid
sequenceDiagram
  participant S as Shell
  participant F as Farm server (127.0.0.1)
  participant W as Window
  S->>S: secret = 32 random bytes, token = 32 random bytes
  S->>F: start({ secret, handshakeToken: token })
  F-->>S: { origin, port }
  S->>W: load /__farm/desktop/handshake?t=token
  W->>F: GET handshake
  F->>F: token matches and is unused: consume it
  F-->>W: Set-Cookie farm_desktop=secret; HttpOnly; SameSite=Strict; Path=/ + 303 to /
  W->>F: every later request with the cookie
```

- The handshake token works once. A second use, or any other token, returns 403.
- Every request needs the cookie, compared in constant time. This covers pages, server functions,
  API routes, endpoints, RSC and route data requests, and the built-in agent surfaces (`/mcp`,
  `/.well-known/*`, Markdown mirrors), as well as static client assets. The shipped desktop
  server entry checks the guard before the Nitro handler; the dev guard runs before Vite.
- `Host` must be `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`, which blocks DNS
  rebinding. A present `Origin` on unsafe methods must match the server origin.
- The guard runs before `runtime.before`, middleware and routing. It is not configurable off; an
  app that wants a public local server builds `--web --preset bun`.
- The window is restricted to the server origin. Other origins open in the system browser.

### 6.4 Data directory

```ts
import { appDataDir } from "@farm.js/core/platform";

const file = join(appDataDir(), "notes.json");
```

| Mode                 | `appDataDir()`                                                     |
| -------------------- | ------------------------------------------------------------------ |
| desktop production   | OS user data dir for the app (passed by the shell), created on use |
| `farm dev --desktop` | `.farm/data/desktop`                                               |
| web                  | `FARM_DATA_DIR` if set, otherwise throws with a hint               |

Storage drivers that take a path (SQLite, the file storage driver) default to `appDataDir()` in
desktop builds.

### 6.5 Desktop defaults

A desktop app is not a public site. Desktop builds turn these off unless the config re-enables
them explicitly:

- sitemap and robots;
- `llms.txt` and `llms-full.txt`;
- the public app manifest (`/.well-known/farmjs`);
- the default read-only `/mcp`, the AI catalog and JSON-LD;
- image optimization (`images.provider` becomes `"none"`, which keeps sharp out of the bundle).

Nothing outside the window can pass the guard, so public agent surfaces are dead weight on desktop.
An app that wants them (for example a local `/mcp` for on-device agents) re-enables them in
config; they stay behind the guard.

### 6.6 Shell adapters

```ts
export interface DesktopShell {
  name: string;
  runtime: "bun" | "node";
  generateMain(ctx: DesktopShellContext): Promise<GeneratedFile[]>;
  dev(ctx: DesktopDevContext): Promise<{ close(): Promise<void> }>;
  package(ctx: DesktopPackageContext): Promise<DesktopArtifacts>;
}
```

- `generateMain` renders the shell main process from a template: start the server, open the window
  on the handshake URL, apply `window` config and `src/desktop.ts` hooks, stop the server on quit.
- `dev` starts the shell with its window pointed at `farm dev`, so HMR, the dev error overlay and
  devtools work as they do in a browser. The guard runs in dev too.
- `package` produces `.app`/`.dmg`, `.exe` and AppImage outputs plus update artifacts when the
  shell supports them.

`desktop.shell` defaults to `"electrobun"`, so `desktop: {}` selects
`@farm.js/desktop/electrobun`. A name (`"electrobun"`, `"electron"`, `"tauri"`) resolves to
`@farm.js/desktop/<name>`; a package name selects a third-party shell. It does not accept an adapter
object: importing an adapter in `farm.config.ts` would pull it into web server bundles for apps
whose config is bundled. Electrobun ships first. Electron (`runtime:
"node"`, in-process in the main process) and Tauri (Bun server as a sidecar) follow.

### 6.7 Desktop output

```text
.farm/output/desktop/
  server/            Nitro output: server/index.mjs, server/chunks/, public/
  shell/             generated shell main and config
  dist/
    Notes.app  Notes.dmg  Notes-setup.exe  Notes.AppImage
    update/          shell update artifacts, when supported
```

## 7. Mobile

### 7.1 Model

A native shell with a native navigator, in the style of Hotwire Native. Every route is a screen in
that navigator, and each route chooses how its screen renders. The default is a Farm page in a
WebView. Native rendering is opt-in per route, and an app pays for a native engine only when at
least one route uses it.

```text
+----------------------- screen -----------------------+
| native chrome: nav bar, search bar                   |
+------------------------------------------------------+
| content, one tier per route (7.2):                   |
|   web       WebView with a Farm page (default)       |
|               optional native islands (7.7)          |
|   native    React Native surface, shared runtime     |
|   platform  Compose or SwiftUI view, no JS engine    |
+------------------------------------------------------+
| native chrome: tab bar                               |
+------------------------------------------------------+
  native pop-ups over any screen: pickers, menus,
  action sheets, camera, share, Face ID
```

| Tier                   | Content                                                     | Added to the app                                  |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| web (default)          | WebView with a Farm page, bundled assets and page shells    | nothing beyond the shell, WebView pool and bridge |
| native, React Native   | a React Native surface                                      | Hermes, Fabric, TurboModules, the screen bundle   |
| native, platform       | a Kotlin/Compose or Swift/SwiftUI view                      | the screen's own native code, no JS engine        |
| island in a web screen | a large fixed native view (`Map`, `Video`, `CameraPreview`) | that component's native view                      |

Rules:

- A screen's content is one tier. Native views inside a web screen are only allowed as islands
  (7.7); free-form mixed content breaks gestures, accessibility order and keyboard handling.
- Every route keeps its `page.tsx`. It is the web page, the mobile web screen, and the runtime
  fallback for the route's native screen (the web twin, 7.10).
- React Native is in the app only if at least one route resolves to a React Native screen. An app
  of web and platform screens ships no JS engine besides the system WebView.

### 7.2 Screen tiers

#### Web screens

The default. A WebView in the native navigator shows the Farm page rendered by `mobile.server`.

- Android bundles content-hashed client assets and serves matching requests on the server's own
  origin from the app bundle. Cache misses load from the server. iOS loads assets from the server
  and uses WebKit's cache: `WKURLSchemeHandler` cannot handle `http` or `https`. Neither platform
  introduces a second origin. See [the implemented asset model](#the-server-picks-the-client-the-app-bundle-is-a-cache).
- Routes that can be pre-rendered get a bundled page shell (layout plus loading state). The shell
  shows instantly while the server document loads, and offline it shows the route's offline state
  instead of a blank screen.
- Pop-up controls and chrome are native (7.6). Device calls go through the async bridge (7.5).
- Web screens work with every renderer.

#### Native screens: React Native

The default native engine. A route's `page.native.tsx`, or the analyzer's port of its `page.tsx`
(7.8), renders as a React Native surface.

- React Native's new architecture only: Hermes bytecode, JSI, Fabric and TurboModules. No legacy
  bridge.
- One JS runtime is shared by all native screens; each screen is its own Fabric surface in it. The
  runtime is created and warmed after the first screen paints (at launch when the start screen is
  native), so an app whose start screen is web pays nothing at startup.
- Data comes from the same server functions and route data requests as the web client (7.14),
  through `@farm.js/native` hooks.
- Native screens navigate by URL (`href`, `navigate("/posts/7")`), never by component, so the
  navigator's rules always decide what the next screen is.
- React only. Other renderers use web and platform screens.

```tsx
// src/app/feed/page.native.tsx
import { List } from "@farm.js/ui";
import { useServerQuery } from "@farm.js/native";
import { listFeed } from "../../features/feed/server";

export default function Feed() {
  const { data = [] } = useServerQuery(listFeed, {});
  return (
    <List
      items={data}
      row={(post) => ({ title: post.title, subtitle: post.author, href: `/posts/${post.id}` })}
      refreshable
    />
  );
}
```

#### Native screens: platform

Optional, for screens that should run no JS at all: Kotlin with Jetpack Compose on Android, Swift
with SwiftUI on iOS.

```kotlin
// src/app/map/page.kt
@FarmScreen("/map")
@Composable
fun MapScreen(farm: FarmScreenScope) {
  val places by farm.query(FarmServer.listPlaces(region = farm.params["region"]))
  PlacesMap(places, onSelect = { farm.navigate("/places/${it.id}") })
}
```

```swift
// src/app/map/page.swift
@FarmScreen("/map")
struct MapScreen: View {
  @Environment(\.farm) private var farm
  var body: some View { PlacesMap(region: farm.params["region"]) }
}
```

- Found by file location: `page.kt` and `page.swift` in the route directory. A screen kept
  elsewhere (for example in an existing native module) is found by its `@FarmScreen("/route")`
  annotation (a Swift macro on iOS). Two screens for one route on one OS is a build error.
- Zero JS engine: a platform screen adds its own code and nothing else.
- Server functions are called through Kotlin and Swift clients generated from the server-function
  contract manifest (7.14), over the same transport as the web client.
- Platform screens do not depend on the app's renderer.

### 7.3 Choosing a screen

#### File convention

```text
src/app/feed/
  page.tsx            web page, mobile web screen, runtime fallback
  page.native.tsx     React Native screen on iOS and Android
  page.ios.tsx        overrides page.native.tsx on iOS
  page.android.tsx    overrides page.native.tsx on Android
  page.kt             platform screen on Android
  page.swift          platform screen on iOS
  layout.native.tsx   native stack and tab options for this segment
```

- `page.native.tsx` next to `page.tsx` makes the route native on mobile, unless the page export or
  the config says otherwise (precedence below). `page.ios.tsx` or `page.android.tsx` replaces it
  on that OS. Either one alone makes the route native on that OS only; the other OS stays web.
- `page.tsx` is required. A native file without one is a build error, because the route would have
  no web page and no fallback.
- A React Native file and a platform file for the same route and OS is a build error.
- Web and desktop builds never resolve these files. They are not routes, not in the generated
  route types, and not in any web bundle.
- `layout.native.tsx` sets navigator options for every screen under its segment, web or native
  (large titles, header tint, tab bar visibility). Its default export wraps the segment's React
  Native screens, for providers. It has no effect on web screen content.

```tsx
// src/app/notes/layout.native.tsx
export const stack = { largeTitle: true, tint: "accent" };

export default function NotesLayout({ children }: { children: React.ReactNode }) {
  return <NotesStoreProvider>{children}</NotesStoreProvider>;
}
```

#### Page export

```tsx
// src/app/notes/[id]/page.tsx
export const mobile = { presentation: "modal", prefetch: "intent", native: false };
```

- `presentation`: `"push" | "modal" | "replace"`, as in `mobile.routes`.
- `prefetch`: `"intent" | "off"`, overrides `mobile.native.prefetch` for this route (7.9).
- `native: false`: the route is always a web screen; config and the analyzer cannot change it.
  When a native file exists next to it, the build warns that the file is unused.
- The export must be a static object literal. It is read from the source with Oxc at build time
  and never executed by the shell.

#### Config

```ts
type FarmScreenTier = "web" | "native" | "platform";

interface FarmMobileNativeConfig {
  /** What `screen: "native"` and analyzer ports use. Default "react-native". */
  engine?: "react-native" | "platform";
  /** The build-time analyzer (7.8). Default "report". */
  auto?: "off" | "report" | "on";
  routes?: Record<
    string,
    {
      screen: FarmScreenTier;
      android?: FarmScreenTier; // per-OS override of `screen`
      ios?: FarmScreenTier;
      presentation?: "push" | "modal" | "replace";
    }
  >;
  /** Islands that may render natively inside web screens (7.7). Default []. */
  islands?: string[];
  /** Default "intent". */
  prefetch?: "intent" | "off";
  /** Checked in CI (7.9). */
  budgets?: { appSizeMb?: number; screenOpenMs?: number; droppedFrames?: number };
}
```

- Keys are page route patterns, checked like `mobile.routes` keys (#2420): unknown routes and wrong
  param names fail with the OS and field.
- `screen: "native"` uses `engine`. With `"react-native"` it uses the route's `page.native.tsx`
  (or OS file); without one, it asks the analyzer to port that route even when `auto` is
  `"report"`, and fails the build with the analyzer's reasons when it cannot.
- `screen: "platform"` always needs `page.kt` or `page.swift` for that OS.
- `screen: "web"` keeps the route web on that OS even when native files exist.
- `engine: "platform"` means the app has no React Native: `.native.tsx` files are a build error and
  the analyzer can only emit Compose and SwiftUI (stage 4, 7.8).
- `presentation` here and in `mobile.routes` is the same field; setting it in both for one route is
  a validation error.
- `mobile.native` replaces the previous draft's `mobile.routes[x].native: "<module>"`.

#### Precedence

For each route and OS, the first source that decides wins:

1. the page export: `export const mobile` in `page.tsx`;
2. the config route: `mobile.native.routes[pattern]` (the OS key, then `screen`), and
   `mobile.routes[pattern]` for presentation;
3. the native files next to `page.tsx`: an OS file, then `page.native.tsx`, or a platform file;
4. the analyzer's decision, when `auto` is `"on"`;
5. web.

Native files sit below the config route so a config can keep one OS on web while its native
screen is in progress, and above the analyzer so a hand-written screen always beats a generated
port. A page export that overrides a config route gets a build warning that names both.
`farm config inspect --mobile --os <os>` prints the resolved tier and presentation of every route
and the source that decided it.

### 7.4 Navigation

A native navigator owns the stack. It is built from `farm-routes.json`, generated per OS from the
app directory routes, `mobile.tabs`, `mobile.routes`, `mobile.native` and page exports:

```json
{
  "version": 1,
  "server": "https://notes.example.com",
  "tabs": [
    { "path": "/notes", "title": "Notes", "icon": "note.text" },
    { "path": "/settings", "title": "Settings", "icon": "gear" }
  ],
  "rules": [
    { "route": "/notes/new", "pattern": "^/notes/new/?$", "presentation": "modal" },
    { "route": "/notes/[id]", "pattern": "^/notes/[^/]+/?$", "presentation": "push" },
    {
      "route": "/feed",
      "pattern": "^/feed/?$",
      "presentation": "push",
      "screen": "native",
      "module": "feed"
    },
    { "route": "/notes", "pattern": "^/notes/?$", "presentation": "tab", "tab": 0 },
    { "route": "/settings", "pattern": "^/settings/?$", "presentation": "tab", "tab": 1 },
    { "pattern": "^/", "presentation": "push" }
  ],
  "shells": { "/notes": "shells/notes.html", "/notes/[id]": "shells/notes-id.html" }
}
```

- One rule per page route in client router order, then a `^/` push fallback. Patterns use the
  regex subset Kotlin, Swift and JS share. A rule without `screen` is a web screen; `module` names
  the bundled native or platform screen.
- A rule separates which screen (`screen`, `module`) from how it is presented (`presentation`). A
  modal never replaces the root.
- `"tab"` is a generated presentation for a route listed in `mobile.tabs`; `tab` is its index.
  It is not a user-selectable `mobile.routes.presentation` value. The public presentation union
  stays `"push" | "modal" | "replace"`; the manifest adds tab switching for the native navigator.
- In the app, Farm's client router does not navigate in place. The shell registers
  `delegateNavigation` (#2419), each in-app navigation becomes a `visit` message, and the navigator
  pushes, presents or switches tabs by the matching rule. `shouldOverrideUrlLoading` and its iOS
  equivalent stay as the backstop for document loads, which the delegate does not see.
- Off-origin http(s) links open in `SFSafariViewController` or Custom Tabs. `file:`, `content:`,
  `javascript:` and `intent:` links are never handed to other apps.
- Each stacked web screen keeps its own WebView, so streamed and hydrated state survives going
  back. A capped pool of pre-warmed WebViews (bridge registered and Farm client runtime loaded
  before the first navigation) backs pushes, so a new screen does not pay WebView startup.
- Android WebViews share one renderer process. The shell handles `onRenderProcessGone` on every
  WebView and reloads the affected screens instead of crashing the app.

### 7.5 Native modules

Device APIs come from React Native modules. Farm adds the plumbing around them (linking,
permissions, a transport for web screens), not a module system of its own. Revised 2026-11-05; see
[Device APIs are React Native modules](#device-apis-are-react-native-modules).

```text
native screen  page.native.tsx ──JSI──▶ TurboModule (community or the app's own)
web screen     page.tsx ──bridge `call`, async JSON──▶ the same module class, opted in per module
visual or continuous (camera preview, map, video) ──▶ a native view: native screen, or island (7.7)
```

- **Native screens use the React Native ecosystem as is.** Any module that supports the new
  architecture works in `page.native.tsx` after a normal install. The generated Android host
  autolinks the app's dependencies (React Native's Gradle settings plugin,
  `autolinkLibrariesWithApp()`, and the autolinked C++ TurboModules in `OnLoad.cpp`), only when the
  app has native screens, so a web-only app still gets no React Native code.
- **The app's own modules are TurboModules written the React Native way:** a Codegen spec such as
  `src/native/NativeHaptics.ts` (`TurboModuleRegistry.getEnforcing<Spec>("Haptics")`) and one
  Kotlin and one Swift class. Farm copies them into the generated projects and registers them; there
  is no Farm-specific spec format.

```ts
// src/native/NativeHaptics.ts
import { TurboModuleRegistry, type TurboModule } from "react-native";

export interface Spec extends TurboModule {
  impact(style: string): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>("Haptics");
```

- **`mobile.modules` holds what the OS needs:** permission entries and usage strings, per module
  (`mobile.modules.camera.usage` becomes `NSCameraUsageDescription` and the Android
  `<uses-permission>`). A module that needs a permission and has none configured fails the build
  with the key to add.
- **Web screens reach a module only when it opts in** (`mobile.modules.<name>.web: true`). The
  bridge's `call` message dispatches to the same Kotlin or Swift class, for methods that return a
  `Promise` in its Codegen spec, with arguments checked against the spec before the module runs.
  Modules that need the React Native JS runtime, which is most community modules, are not
  reachable from web screens; a route that needs them becomes a native screen.
- **References, not bytes.** A large result (a photo, a recording, a picked file) comes back as a
  URL, never as base64 through the bridge. On Android it is an unguessable path on the server's own
  origin (`/__farm/files/<id>`) that the shell answers from app storage in `shouldInterceptRequest`,
  as it answers bundled client files, scoped to the screen that asked and dropped when it closes.
  iOS cannot answer `https` requests (7.12) and a custom scheme would be mixed content, so iOS
  returns such results as a native upload to a server route instead (open question 8).
- **Events are subscriptions.** `subscribe` and `unsubscribe` bridge messages, at most one delivery
  per animation frame with the latest value. The shell closes every subscription of a page when its
  document changes, its screen pops, or a pooled WebView moves to another route.
- **Visual and continuous features are native views.** Camera preview, maps and video never stream
  frames through JS: native screens render them, and web screens use islands (7.7). JS sends
  commands only.
- **No JS engine for web screens.** A web screen's code runs in the system WebView's engine, in
  another process (Android's sandboxed renderer, iOS's WebContent process). A second engine in the
  app process could not share its heap, and the only synchronous Android hook,
  `addJavascriptInterface`, is ruled out by 7.10. The web transport stays async; direct calls are
  what native screens are for.
- `native.<module>.available()` checks first. Where a web fallback exists (`<input type="file"
capture>`, `navigator.share`) web and desktop use it; other calls reject with
  `NativeUnavailableError`.
- Farm does not reuse Capacitor's bridge. Its Android fallback to `addJavascriptInterface`, and
  plugins that register one unconditionally, conflict with the bridge rules in 7.10.

### 7.6 Components

`@farm.js/ui` components render as DOM on web, desktop and mobile web screens, and as native views
on native screens. The import is the same; the screen tier decides the host.

| Kind            | Components                                        | Mobile web screen                                                                          | Native screen           |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------- |
| Primitives      | `View`, `Text`, `Image`, `Pressable`, `TextInput` | DOM                                                                                        | React Native host views |
| Lists           | `<List>` with template rows                       | DOM                                                                                        | recycling native list   |
| Pop-up controls | `Select`, `DatePicker`, `Menu`, `ActionSheet`     | native pickers and menus via the bridge when enabled in `mobile.components`, otherwise DOM | native                  |
| Chrome          | `NativeBar`, `SearchBar`, `Tabs`                  | configure the native nav bar, search bar and tab bar                                       | same                    |
| Islands         | `Map`, `Video`                                    | DOM, or an island when listed in `mobile.native.islands` (7.7)                             | native view             |

Native-only components such as `CameraPreview` and `ApplePayButton` live in `@farm.js/native`.
They are native views on native screens, islands on web screens when listed in
`mobile.native.islands`, and render their `fallback` prop on web and desktop (or nothing, with a
development warning). Farm does not invent web equivalents for them.

- This replaces the 2026-10-29 rule that shared components are always native islands on mobile. On
  a web screen a `View` or a `List` is DOM; a route that needs native lists becomes a native screen.
- `<List>` rows are templates (`title`, `subtitle`, `image`, `badge`, `href`, `swipeActions`, plus
  list-level `refreshable` and `searchable`), so the same data renders as DOM rows or native cells.
- Styling is token props (`padding="md"`, `background="surface"`, `radius="card"`) or a Tailwind
  subset compiled the NativeWind way. Arbitrary CSS is not accepted on these components; that limit
  is what keeps them portable, and the analyzer relies on it (7.8).
- `@farm.js/ui` is React first, like native screens.

### 7.7 Native islands

An island is a native view inside a web screen, at a placeholder element's position. Islands are
limited to large, fixed-size components where a native view clearly beats the web version and the
limits below do not matter: `Map`, `Video` and `CameraPreview` first. Everything else is DOM on web
screens or a native screen.

Why islands are this narrow (research on the Android WebView native boundary, 2026-11-01):

- Stock Android System WebView has no public API that puts a native view into the page's
  compositor layers. Same-layer rendering exists only where the vendor owns the engine (WeChat's
  forked Chromium, HarmonyOS ArkWeb's `enableNativeEmbedMode`). Every Android island therefore
  sits outside the page, under the WebView or above it.
- Under a transparent WebView (the official Capacitor maps plugin): web content can draw over the
  island through a hole, but its position follows scroll through JS messages at least a frame
  behind, every touch waits on a JS hit test, and users report maps that do not scroll with the
  page.
- As a child of the WebView (`WebView` still extends `AbsoluteLayout`): a child at content
  coordinates may follow the root scroll with no messages and receives touches directly, but it
  always paints above all web content. `z-index`, `overflow` clipping, `border-radius`, transforms,
  sticky and fixed ancestors and nested scrollers cannot reach it. No source confirms that it stays
  frame-aligned with today's out-of-process WebView, and no maintained library uses this path.
- The previous draft's general island renderer (a React reconciler in the WebView sending view ops
  to native) spends its effort on the part with prior art, the op protocol, and none on the part
  without it, compositing.

Contract:

- Android: the island is a child of the WebView in content coordinates, on top of web content. iOS
  uses the same contract. WebKit's `WKChildScrollView` could do more there, but only through
  private API, and the two platforms would behave differently.
- The island follows root-document flow and scroll. Placeholders inside nested scrollers or under
  sticky, fixed or transformed ancestors are rejected in development, and at build time where
  statically visible; at runtime they render the DOM version.
- Nothing in the page draws over an island. While a web sheet, menu or toast must cover it, the
  island is hidden or replaced by a snapshot of itself.
- The island has a fixed height or reports one. Geometry is sent only on layout change
  (`ResizeObserver`, font load, navigation), on a channel separate from props and events.
- Props and events cross the bridge as messages; there is no view tree. Every island has a web
  fallback, its DOM version, used on a render error and whenever the island is not listed in
  `mobile.native.islands`.
- Map, video and camera views often use `SurfaceView`, which is a separate risk for position and
  z-order.

Still to run: the scroll-tracking experiment in section 4 of the research report. Emulator images
for three API levels with host GPU and SwiftShader, a child placed once, a child repositioned on
scroll, and two sibling strategies, plus `SurfaceView` and `TextureView` variants, measured frame
by frame from screen recordings. Islands that scroll with the page ship on Android only if the
child placed once shows a 0 px offset in at least 99% of frames and never more than 1 px across
fling, overscroll and keyboard resize. If it shears and repositioning on scroll fixes it, the shell
adds native scroll reconciliation. If both shear, Android islands are limited to placements that do
not scroll (full-bleed or fixed to the viewport), and other cases become native screens.

### 7.8 Auto-native: the build-time analyzer

An optional build step that finds routes which can become native screens without changes, and
ports the ones where native is measurably better. A route is ported only when every part of it is
proven portable; any doubt keeps it web.

```text
route entry: page.tsx and its layouts
  -> parse with Oxc, walk the route's client module graph (resolved like the client build)
  -> classify every JSX element, style, hook, browser API and import
  -> Farm UI IR: View / Text / Image / List / Pressable / TextInput
       + design tokens, props, events and data dependencies (route data, server functions)
  -> emit DOM (to check the IR) or React Native; later Compose and SwiftUI
```

The IR is platform-neutral and is the same vocabulary `@farm.js/ui` primitives use.

#### Portability rules

Ports:

- intrinsic elements with an IR mapping: `div`, `section`, `p`, `span`, headings, `img`, `a`,
  `button`, `input`, `textarea`, `ul`, `li`;
- `@farm.js/ui` components, and app components whose own module graph ports;
- token props, the Tailwind subset, and static CSS module rules with mapped properties (flex
  layout, spacing, size, color, border, radius, typography, opacity);
- `useState`, `useReducer`, `useMemo`, `useCallback`, `useContext` of portable providers, Farm
  data hooks, route params and `navigate`;
- `onClick`, `onChange` and `onSubmit` on mapped elements;
- pure JS imports, server functions and route data.

Blocks (the route stays web):

- `dangerouslySetInnerHTML`, `contentEditable`, `iframe`, `canvas`, `video`, unmapped `svg`,
  portals;
- packages with no mapping, and components reached through values the analyzer cannot resolve;
- grid, `position: fixed` and `sticky`, pseudo-elements, keyframes and transitions, media queries
  other than color scheme, runtime CSS-in-JS, class names built at runtime;
- refs used for DOM methods, `useLayoutEffect`, effects that read the DOM or browser globals;
- other DOM events: scroll, pointer, drag and keyboard handlers;
- `window`, `document`, storage and observer APIs, form `action` server actions, server
  components.

#### Report

```text
farm build --mobile   (mobile.native.auto: "report")

route          decision  reason
/feed          port      portable; unbounded list, scroll-heavy
/notes/[id]    web       src/app/notes/[id]/page.tsx:41:9 dangerouslySetInnerHTML
/settings      web       portable; no win (static form, 18 nodes)
/map           web       src/features/map/MapView.tsx:12:1 import "leaflet" has no mapping

full report: .farm/output/mobile/native-report.json
```

Every `web` decision names its first blocker with file, line, column and rule. The JSON lists every
blocker per route, so a team can see what a route needs to become portable.

#### Cost model

Porting is not free: the first ported route adds React Native to the app, and every native screen
is code the web build does not test. The analyzer ports a portable route only when native wins:

- lists, especially long or unbounded ones;
- heavy scroll;
- gestures (swipe actions, drag, pan);
- frequent updates (live data, input-driven state, timers).

Portable routes without a win stay web: articles, static content, short forms, settings. A port
must also keep the app within `mobile.native.budgets`.

#### Checks

- Planned visual diff in CI: for each ported route, the web screen and the native screen render on
  an emulator with the same fixture data and are compared. A difference over the threshold demotes
  an analyzer-selected port to web, and the report says why. An explicit page or config native
  choice fails the check with the route and difference instead; it is never silently demoted.
- Runtime fallback: the web twin stays in the app, and a crash or contract mismatch on the native
  screen shows it (7.10).
- The analyzer runs in `farm build --mobile` only, never in `farm dev` or a web build. In
  `farm dev --mobile`, routes that are only analyzer ports show as web screens.
- React only, since it reads JSX.

#### Stages

| Stage | What it does                                                                  | Needs                                                                                                   |
| ----- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 0     | `auto: "report"`: classification and reasons, output unchanged                | Oxc parse, module graph walk, classifier, report format                                                 |
| 1     | builds the IR and emits DOM from it, compared with the real page in CI        | the IR, a DOM emitter, a Playwright visual diff                                                         |
| 2     | emits React Native for routes set to `screen: "native"` without a native file | React Native screens (7.2), the RN emitter, emulator visual diff, the web twin fallback                 |
| 3     | `auto: "on"`: ports every route the cost model picks                          | a cost model measured on devices, budgets in CI, remote rollback (7.10)                                 |
| 4     | Compose and SwiftUI emitter from the same IR (`engine: "platform"`)           | platform screens, the IR's state and event model in Kotlin and Swift, generated server-function clients |

Stage 0 needs no native engine and costs only build time, so it can ship first and show how many
real routes would port.

### 7.9 Performance

- **Hermes bytecode.** Native screen JS is compiled to Hermes bytecode at build time; the device
  does not parse or compile it.
- **One shared runtime, pre-warmed.** Created after the first screen paints, or at launch when the
  start screen is native, with `@farm.js/native` and shared modules already loaded. The first native
  screen does not pay runtime startup.
- **Intent prefetch.** A touch-down on a link (pointer down on a web screen, press-in on a native
  screen) sends an `intent`. The navigator starts the target's route data request in parallel with
  creating the screen (a pooled WebView or a Fabric surface) and hands the response to it.
  `prefetch: "off"` turns it off per route or for the app.
- **Recycling native lists.** `List` on native screens recycles cells. Rows are templates, so
  recycling needs no app code.
- **Farm's React compiler on the native bundle.** Its memoization transforms run on React Native
  screens; DOM-specific fast paths stay off there.
- **JSI, not JSON.** Native screens call modules and the navigator through JSI. JSON exists only on
  the web-screen bridge, which carries small messages; large payloads go through the scheme handler
  or a normal request.
- **Web screens start local.** Bundled assets and page shells, and pushes take a pre-warmed WebView
  (7.4).
- **Budgets in CI.** `mobile.native.budgets` is checked by the mobile acceptance run: `appSizeMb`
  on the release artifact, `screenOpenMs` from tap to first content per route on the reference
  emulator, `droppedFrames` during a scripted scroll of each native route. A miss fails the run and
  names the route.

The bundler for React Native screens is Metro. The spike and the reasons are in
[Decisions since the 2026-11-01 revision](#decisions-since-the-2026-11-01-revision).

### 7.10 Safety

- **Web twin fallback.** When a native or platform screen throws while mounting or rendering, or
  its server-function contract does not match the server (7.14), the navigator replaces it with the
  route's web screen and reports the error. The web screen is rendered by the deployed server, so it
  always matches it.
- **Remote rollback of route rules.** At launch the shell fetches a rule override from
  `mobile.server` over https, with a short timeout, and caches it. An override can only demote:
  native or platform to web, islands off, prefetch off. It cannot add routes or point a route at
  code that is not in the app.
- **Bundled code only.** Native screens run code that shipped in the app. No JS or native code is
  downloaded; a new or fixed native screen ships in a new build.
- **Bridge.** Registered only for the server origin and the bundled asset origin
  (`addWebMessageListener` with explicit origin rules on Android, origin and frame checks in
  `WKScriptMessageHandler` on iOS), installed by a document-start script before page code, accepts
  messages from the main frame only, and dispatches only to modules enabled for the app and methods
  in their spec. Unknown modules, methods and island ids are rejected.
- **No `addJavascriptInterface` fallback.** It reaches every frame and every later page and cannot
  tell who called. On a WebView without `WEB_MESSAGE_LISTENER` (older than 82) the bridge is absent
  and native calls reject with `NativeUnavailableError`.
- **Development-only launch overrides.** Launch extras that change the server or the pool size
  work only in debuggable builds. Release builds use the bundled `server`, over https only.
- **Server-function contract checks.** Per build, as in 7.14. The same record decides on the device
  when a native screen falls back to its web twin.

### 7.11 Styling

- Web screens keep the app's CSS.
- Farm injects a small mobile base stylesheet: system font, `env(safe-area-inset-*)` padding,
  `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: none`, plus `data-platform`.
- Design tokens live in `src/theme.ts`:

```ts
import { defineTheme } from "@farm.js/core/theme";

export default defineTheme({
  color: {
    accent: { light: "#2f6f4f", dark: "#7fc8a0" },
    background: { light: "#fff", dark: "#111" },
  },
  radius: { card: 12 },
  font: { body: "system" },
});
```

| Target           | Token output                                                     |
| ---------------- | ---------------------------------------------------------------- |
| Web, desktop     | CSS custom properties, dark values under `prefers-color-scheme`  |
| iOS              | `Theme.swift` plus an asset catalog with dark variants           |
| Android          | `themes.xml` and `colors.xml` (Material 3, `values-night`)       |
| React Native     | a theme object, and a NativeWind preset when NativeWind is used  |
| Platform screens | the iOS and Android outputs above, read from Compose and SwiftUI |

Native parts accept token-level styling only (colors, radii, fonts, spacing). There is no general
CSS-to-native compiler; the analyzer ports only the mapped subset (7.8).

### 7.12 Mobile output

```text
.farm/output/mobile/
  www/
    assets/              bundled content-hashed client assets
    shells/              pre-rendered page shells
  native/                only when a route is a React Native screen
    index.js             generated entry that registers every screen by module id
    index.android.hbc    React Native screens, Hermes bytecode (assets/farm-native.hbc in the APK)
  farm-routes.json
  native-report.json     analyzer report, when auto is not "off"
  ios/
    App/
      Navigator.swift  WebViewPool.swift  Bridge.swift  Theme.swift
      Screens/           platform screens, generated module glue
      Assets.xcassets  Info.plist
  android/               Gradle project: navigator, WebView pool, bridge, themes, platform screens
  dist/
    Notes.ipa  Notes.aab
```

### 7.13 Development

`farm dev --mobile` starts `farm dev`, writes `farm-routes.json` with an address the device can
reach (`http://10.0.2.2:<port>` for the Android emulator, or the `--host` address), generates the
native project, and installs and opens the app when a device or emulator is connected (#2422,
Android). Web screens get HMR. React Native screens get Fast Refresh from the native bundler (7.9).
Platform screens rebuild through Gradle or Xcode.

### 7.14 Backend

The server for a mobile app is either:

- **self-hosted**: `mobile.server` is the URL of a `--web` deployment of the same app. The preview
  has no installed-version compatibility gate yet. The contract-aware design below requires a
  server build with its current contract and retained contracts for supported mobile builds; or
- **managed**: Farm.js Infrastructure deploys the Farm server for the app ("deploy my Farm
  server"). This is a future Infra product and out of scope for the first implementation.

Rules that hold either way:

- **Auth uses tokens.** Tokens live in the Keychain (iOS) or Keystore (Android). The shell sets the
  session cookie on the WebView cookie store for the server origin at launch and after refresh;
  native and platform screens send `Authorization: Bearer`. Auth integrations need a token mode
  (issue, refresh and accept bearer tokens) for this to work.
- **Planned contract gate, not implemented.** Each web build emits its server-function and
  route-data contract, and a mobile build embeds the contract it was built against. The app owner
  retains the manifests for mobile builds it supports, keyed by app id, platform, version and
  build id, and supplies them to every server deployment. Self-hosting needs the same inputs as
  managed hosting; a current server manifest alone cannot identify affected installed versions.
  The deployment check compares the new server with every retained supported contract and fails
  on an incompatible removal or schema change, naming the affected builds. Missing retained
  manifests or schemas that cannot be compared must fail the check, not assert compatibility.
  Retention ends only when the owner explicitly ends support for that build. Storage and CLI
  configuration for this registry still need a separate implementation proposal. The same schema
  record is a prerequisite for generated Kotlin and Swift clients.
- **Planned minimum version, not implemented.** The proposed `mobile.minimumVersion` lets the
  server reject unsupported apps with a response the shell turns into an update prompt.

## 8. Capability matrix

| Capability       | web                 | desktop                          | mobile                                                       |
| ---------------- | ------------------- | -------------------------------- | ------------------------------------------------------------ |
| UI               | browser             | system WebView                   | native chrome; web, React Native or platform screens         |
| SSR              | yes                 | yes, local                       | yes, remote, for web screens                                 |
| Server functions | yes                 | yes, local                       | yes, remote, contract-checked                                |
| Offline          | PWA, optional       | yes, server is local             | bundled shells, assets and native screens; data needs server |
| Local files      | host-dependent      | yes, `appDataDir()`              | through native modules only                                  |
| HMR              | yes                 | yes, window loads `farm dev`     | WebView HMR, Fast Refresh for React Native screens           |
| Agent-readiness  | full, on by default | off or guarded (6.5)             | served by the web deployment                                 |
| Native features  | web APIs            | shell APIs (menu, tray, dialogs) | React Native modules; opted-in modules on web screens (7.5)  |
| Native islands   | DOM                 | DOM                              | `Map`, `Video`, `CameraPreview` when listed (7.7)            |
| Auth             | cookies             | cookies, local guard             | Keychain/Keystore tokens                                     |
| Store acceptance | n/a                 | signing and notarization (open)  | native navigation and chrome (see 7.1)                       |

## Decisions since the 2026-11-01 revision

Made while building the iOS shell (#2441), `@farm.js/native` (#2444) and the Android React Native
host (#2445). They narrow 7.2, 7.9, 7.10 and 7.12 without changing the model.

### Metro bundles React Native screens

Measured on `examples/mobile` (two screens), macOS arm64, Node 24, React Native 0.88.1:

|                 | Metro                                  | Rolldown with a Babel Flow strip                   |
| --------------- | -------------------------------------- | -------------------------------------------------- |
| cold bundle     | 5.7 s                                  | 1.9 s, 1.8 s of it Babel on 474 React Native files |
| warm bundle     | 0.4 to 3.9 s                           | not measured                                       |
| minified JS     | 866 KB                                 | 659 KB                                             |
| Hermes bytecode | 1.23 MB (595 KB compressed in the APK) | 1.11 MB                                            |

- Rolldown cannot parse React Native's own sources: they use Flow types, Flow `as` casts and Flow
  enums, which need React Native's Babel setup (its Flow parser and enum transform) in front of
  Rolldown anyway.
- A Rolldown bundle would also have to reproduce Metro's prelude (`setup-env`, the JS
  polyfills), the asset registry, the `__d` module format that HMR relies on, and Fast Refresh.
  That is days of work for a runtime nobody has run, and Metro is what React Native libraries are
  tested against.
- `@farm.js/native/build` owns the step: it writes one entry that registers every screen under its
  module id, bundles it with Metro using React Native's own Metro config (an app
  `metro.config.js` wins), and compiles it with the `hermesc` that ships with the app's
  `react-native`. `farm dev --mobile` runs Metro next to the dev server for Fast Refresh.
- Metro watches only the dependency closure a screen bundle can reach, not the workspace root. In
  this monorepo the first Metro run went from 2 min 20 s to under 6 s.
- A Rolldown path can come later behind the same `./build` API if its size win holds on a device.

### React Native 0.88.1 from prebuilt Maven artifacts

- New architecture only: Hermes, Fabric, bridgeless.
- The generated project depends on `com.facebook.react:react-android` and
  `com.facebook.hermes:hermes-android` from Maven. There is no React Native Gradle plugin and no
  Codegen run; the shell's `FarmShell` module goes through the TurboModule interop layer.
- One small native library, `libappmodules.so` (`OnLoad.cpp` and CMake against react-android's
  prefab, NDK 27.1.12297006), sets React Native's core Java TurboModule provider. Without it core
  modules such as `PlatformConstants` are missing and React Native fails at startup, which was seen
  on the emulator. This is the one step that needs the NDK.
- All of this is added only when a route resolves to a React Native screen on Android: the
  dependencies, Kotlin 2.2.21 (React Native's artifacts carry Kotlin 2.2 metadata),
  `abiFilters` `arm64-v8a` and `x86_64`, the CMake build and the bytecode asset. A project without
  native routes gets the same Gradle files, manifest, resources and assets as before; its debug APK
  grows by 4 KB for the engine-neutral hook.
- Amended 2026-11-05: apps that link community React Native modules (7.5) use React Native's
  Gradle plugin and its toolchain. New-architecture modules apply `com.facebook.react` in their own
  `android/build.gradle` for Codegen and for `react-android:+` substitution, so they cannot build
  without it. The plugin is not on Maven Central for 0.88, so it is a composite build from the
  app's `node_modules/@react-native/gradle-plugin`, and with it come Android Gradle plugin 9.2.1,
  Gradle 9.4.1, `android.builtInKotlin=false`, `android.newDsl=false` and a JDK 17 toolchain. Farm
  writes `autolinking.json` from the app's own `dependencies` (the packages Metro bundles) and the
  plugin's `autolinkLibrariesFromConfigFile` reads it, so `@react-native-community/cli` is not
  needed. `libappmodules.so` is then built with React Native's app setup, which adds the
  autolinking sources and each module's codegen library. A module without `codegenConfig` fails
  generation with an error naming it. Apps without native modules are unchanged: prebuilt Maven
  artifacts, no plugin, the shell's own toolchain, byte-identical generated projects.

### Native screens are surfaces in Farm's navigator

- Each React Native screen is a `ReactSurface` created from one shared `ReactHost` and placed in
  the navigator's own screen view, the same container a web screen's WebView uses. It is not a
  Fragment, a `ReactActivity` or a React Navigation screen. Push, pop, predictive back, modals and
  tabs run the same code for web and native screens.
- The shell talks to an engine-neutral hook: `FarmNativeEngine` (`warm`, `open`) and
  `FarmNativeHost` (`visit`, `fallback`, `setTitle`, `rendered`). React Native is one
  implementation; platform screens can use the same hook later.
- The host is warmed after the first screen shows content, together with the WebView pool, and
  its native libraries load on a background thread.
- Web twin: when the engine cannot open a screen, the runtime fails at start (missing or broken
  bundle, JS fatal), or a screen throws while loading or rendering, the navigator replaces that
  screen's content with a WebView of the same URL and logs the reason. In a built app, after a
  runtime failure every native screen opens as web; in dev the next open retries.

### The iOS project is a generated pbxproj

- `@farm.js/mobile/ios` writes `App.xcodeproj` itself: a hand-written, deterministic
  `project.pbxproj` whose object ids are a SHA-1 of a fixed key per object, plus a shared scheme
  and a workspace. No XcodeGen, CocoaPods or Swift package.
- A Swift package alone cannot produce an iOS `.app` with an `Info.plist`, an asset catalog and a
  scene manifest through `xcodebuild`.
- The project is byte-identical across runs, so tests parse and compare it directly (every object
  id resolves, every Swift file is in the sources phase, the scheme points at the target) and
  regenerating it does not churn.
- The shell is Swift and UIKit for iOS 16 and newer. Farm builds simulator apps only; device
  builds and archives need a signing team set in Xcode.

### One bridge script for both shells

- `templates/shared/farm-bridge.js` is the only bridge script. Each generator fills in the OS name
  and the message port: Android's `WebMessageListener` object, or the iOS
  `WKScriptMessageHandler`. Both carry the same JSON messages, so `visit`, `render`, `call` and
  the rest behave the same on both OSes.
- On iOS the script is a document-start `WKUserScript` on the main frame, wrapped in a
  `location.origin` check because `WKUserScript` has no origin rules, and the handler drops any
  message that is not from the main frame of the server origin and from its own WebView. This is
  the iOS form of the rules in 7.10.

### `data-farm-shell` marks pages in a shell

- The bridge script sets `data-farm-shell="android"` (or `"ios"`) on `<html>` at document start,
  before the page renders (#2427).
- App CSS uses it to hide web chrome the shell already draws, such as web tabs:
  `html[data-farm-shell] .web-tabs { display: none }`.
- `platform()` cannot do this: web screens are rendered by the web deployment, where it is
  `"web"`. An attribute set before first paint needs no JS in the app.

### Native screens sign in with device tokens (#2470)

Narrows 7.14 "Auth uses tokens" and the "Token auth" blocker: one Farm-level token, not a token
mode per auth integration.

- After a sign-in on a web screen, the shell's native code trades the WebView's cookie session for
  a device token: `POST /__farm/mobile/session/challenge` returns a one-time nonce, and
  `POST /__farm/mobile/session` with the nonce and the same cookies returns an access token
  (15 minutes) and a refresh token (30 days). Refresh and revoke are
  `POST /__farm/mobile/session/refresh` and `/revoke`, with the token as the bearer. Every field
  travels in headers.
- Endpoints answer only requests with `X-Farm-Mobile: <mobile.id>` and no `Origin` or
  `Sec-Fetch-*` header, a shape no browser sends. The nonce and the refresh token never enter a
  WebView or JS.
- Tokens are opaque (device id, secret, key). Farm storage keeps SHA-256 hashes of the secrets and
  the device's cookies sealed with AES-GCM under the key, which exists only in the tokens.
- A valid bearer with the app id it was issued to and no browser headers runs as the device's
  cookie session, with `Origin` set to the request's own origin. `auth.user()`,
  `protectedRoutes`, server functions and integration routes need no token mode, and no origin
  check changed. A bearer on a request with browser headers is ignored.
- Integrations add one method, `session(request)`, that says who the cookies sign in. Issue and
  refresh use it. Covered first: `@farm.js/auth` and `@farm.js/better-auth`; Auth0, Auth.js,
  WorkOS and Supabase need a reader; Clerk refreshes its session cookie in browser JS and needs a
  design of its own.
- Refresh rotates both tokens and revokes the device when a rotated refresh token comes back. A
  web sign-out in the shell's WebView (found through the `farm_mobile` device cookie) or an ended
  session revokes the device.
- Android keeps the tokens encrypted with a Keystore AES-GCM key; iOS in the Keychain,
  this-device-only.
- The server part is a core plugin added only for apps with a `mobile` block. Without one: no
  route, no hook. With one, the web server differs from the same app without the block by this
  plugin alone, and prerendered files stay static.
- Not proven: that the caller is the app's own binary. A non-browser client holding the cookie
  can mint a token, which gives it nothing the cookie does not. App Attest and Play Integrity
  signing the challenge nonce are the follow-up.

### The server picks the client; the app bundle is a cache

Made while building bundled client assets (#2472). Narrows 7.2 and 7.12.

- `farm build` of an app with a `mobile` block builds the client twice into the same output: the
  web client, and the mobile client (the same entry and graph with `platform()` as `"mobile"` and
  the shell's navigation delegate). `.farm/mobile-client.json` records the mobile entry, the
  stylesheet both use, and every content-hashed file a shell document loads. Leaf chunks are
  shared; chunks that import the entry differ by name. `examples/mobile`: 11 files, 380 KB,
  119 KB gzip. An app without the block builds what it did before.
- Shells add `X-Farm-Shell: android|ios` to every document load they start. For such a request
  the server rewrites the document on the way out: the web entry becomes the mobile entry, and
  modulepreload links of web-only chunks go. The response is `private, no-store`, as a guarded
  one; every HTML response of the app carries `Vary: X-Farm-Shell`, and Nitro's `swr` and `cache`
  rules vary on it. Farm's own page caches store the web variant.
- Rejected: the shell rewriting asset URLs to bundled files by a manifest (the shell choosing the
  client). An app built from older source would then run its client against a newer server's
  HTML, route table and server function ids. With the server choosing, a page always runs the
  client its own deployment built.
- The app bundle is a cache keyed by content hash. Android's `shouldInterceptRequest` answers a
  GET on the server origin from `assets/farm-www` only for a path listed in `farm-assets.json`. A
  hashed name only ever has one content, so a hit is the file the server would send, the same
  guarantee immutable caching on the web relies on.
- Version skew needs no handshake: a newer deployment's documents reference names the installed app
  does not have, those miss and load from the network, and the shell logs the miss.
  `farm build --mobile` makes the same build as `farm build`, so an app built from the deployed
  source and environment matches it name for name.
- 7.2 placed bundled assets on a separate https origin behind a scheme handler. Android serves them
  on the server's own origin instead: no second origin for the bridge, cookies, CSP or CORS.
- iOS: `WKURLSchemeHandler` cannot take `http` or `https`, and a custom-scheme asset origin would be
  mixed content in an https page and a second origin. iOS shells send the header and run the
  mobile client from the network, where WebKit's cache keeps it. Serving pages themselves from a
  custom scheme would break the server's cookies and origin checks, so iOS bundling waits for a
  measured need on a device.
- Current gap: prerendered pages are static files the server never sees, so in a shell they load
  the web client. Server components apps now get a mobile client (#2493), and page shells shipped
  in #2496; their simulator verification remains listed in Status above.

### Device APIs are React Native modules

Made 2026-11-05. Replaces the 2026-11-01 text of 7.5.

- The draft's own spec format (`defineNativeModule` from `@farm.js/native/spec`, a generated
  `native` proxy, Farm-built first-party modules) is dropped. Native screens already run React
  Native's new architecture, so its modules (community, Expo where they link, and the app's own
  TurboModules) are the module system, and Farm maintains no camera or location code.
- What the generated Android host lacked: it registered only `MainReactPackage` and Farm's own
  `FarmShellPackage`, and `OnLoad.cpp` resolved no autolinked libraries, so a community module
  installed in the app never loaded. Autolinking is the first step.
- The web-screen transport is kept but narrowed: opt-in per module, Promise methods only, and
  results by reference. It is the bridge's existing `call` message, which today answers
  `native_unavailable` because no module is registered.
- Rejected: a Farm JS engine for web screens to get JSI-style direct calls. The page's code runs in
  the WebView's engine in another process, so an engine of Farm's would add size and still cross a
  process boundary. Direct calls belong to native screens.
- Order: autolinking on Android, then app TurboModules and `mobile.modules`, then the web-screen
  transport with file references and subscriptions. iOS follows when its shell hosts React Native.

## 9. Rollout

Desktop:

1. **Core desktop primitives**: server entry with port 0, local guard, `appDataDir()`,
   `platform()`, desktop defaults, `desktop` config types, the byte-identical `--web` test. Merged
   (#2353).
2. **CLI flags**: `farm dev|build --web|--desktop|--mobile`, `farm eject`. Desktop flags merged
   (#2354).
3. **Electrobun adapter**, and #2303 rewritten as a config-only app: `farm.config.ts` with
   `desktop: {}`, no `desktop/main.ts`, no dev script, no guard plugin. Merged (#2355, #2356).
4. **Electron and Tauri adapters.**

Mobile (0.2.x):

5. **Android web screens.** Released in 0.1.50: `farm dev --host` (#2418), `delegateNavigation`
   (#2419), the `mobile` block and `farm-routes.json` (#2420), the `@farm.js/mobile` Android shell
   with `farm dev|build --mobile [--apk]` (#2422), `data-farm-shell` and `examples/mobile` (#2427).
6. **Production web screens.** Released: bundled client assets (#2472), page shells (#2496),
   token auth (#2470), and the iOS shell (#2441), which CI now builds with Xcode and launches on a
   simulator (#2556, in review). Not started: absolute transport, the contract manifest, and the
   remote rule override.
7. **Native modules.** Device APIs are React Native modules (see
   [Device APIs are React Native modules](#device-apis-are-react-native-modules)). Released:
   autolinking of installed modules (#2523), app TurboModules and `mobile.modules` (#2524), and
   calls from web screens to modules that opt in (#2528), all on Android. Not started: file
   references for large results, subscriptions, and `@farm.js/ui` pop-ups and chrome on web
   screens.
8. **React Native screens.** Released on Android: `page.native.tsx` and OS overrides, the
   `mobile.native` block and `export const mobile` (#2424), `@farm.js/native` with Metro and Hermes
   builds (#2444), the shared pre-warmed runtime and the web twin fallback (#2445), the example's
   `/map` and `/camera` (#2446), and auth, the typed API client and server functions from native
   screens (#2503, #2507). In review: `@farm.js/ui` on native screens (#2545). Not started:
   `layout.native.tsx` providers, intent prefetch, budgets in CI, and the iOS React Native host.
9. **Native islands**: `Map`, `Video`, `CameraPreview`, after the scroll-tracking experiment
   (7.7) decides their Android placement. Not started.
10. **Analyzer stages 1 to 3.** Released on Android: tiers and the native-tier requirement
    (#2473), native-tier pages drawn from the page the server renders (#2474, #2478), and
    generated React Native ports with `auto: "on"`. In review: native-tier pages on iOS (#2495).
    Not started: visual diffs and budgets that demote a route.
11. **Platform screens** (`page.kt`, `page.swift`, `@FarmScreen`) and analyzer stage 4. Not
    started; platform routes show a placeholder.

Both:

12. **Docs and examples**, landing with each phase. The Mobile Apps page describes 0.1.50; each
    open PR updates it for what it adds.

Next, in order, and what blocks it:

- Run the rest of the iOS shell on the simulator job (#2556): native-tier pages (#2495), page
  shells, and the Keychain session. The job launches the app and takes screenshots; it cannot tap,
  so pushes and modals on iOS need a UI test target or a dev launch option that opens a route.
- Build a release APK with R8 and run it. The generated project minifies release builds with no
  keep rules, and no release APK has been built yet.
- Run native sign-in (#2507) and page shells (#2496) on an Android emulator.
- The iOS React Native host. Until it exists, React Native screens, native modules and generated
  ports are Android only, and iOS shows those routes as web screens.

Managed backend hosting in Infra comes after phase 6. iOS has macOS CI with Xcode once #2556
merges; Android needs Linux CI with the Android SDK, the NDK and an emulator before its phases
leave preview.

Each phase has acceptance tests on the production path:

- desktop: guard rejects missing cookie, reused or wrong handshake token, forged cookie, foreign
  `Host`, LAN address, and covers `/mcp` and server functions; data survives relaunch on a new port;
  `stop()` runs shutdown hooks; packaged app boots on macOS, Windows and Linux;
- mobile web screens: navigator rules match generated routes; link taps push, present or switch
  tabs; shells open offline; a contract-breaking deploy fails the check; token refresh updates the
  WebView cookie; the bridge rejects other origins, iframes, unknown modules and unknown methods;
- mobile native screens: an app with only web screens contains no React Native; a native screen
  that throws shows its web twin; a rule override can demote a route but cannot add one; an
  analyzer `web` decision names the blocker's file and line; a visual diff over the threshold
  demotes the route; a budget miss fails the run.

## Blockers and risks

Things that stop a phase from shipping, grouped by who can unblock them. Each phase lists its
acceptance tests in the rollout above; these are the conditions around them.

### Tooling and accounts (maintainer)

- **Android SDK and emulator** are in use: #2422 was verified on an Android 15 emulator.
- **Android NDK and CMake** (about 2.5 GB) are needed to compile `libappmodules.so` for React
  Native screens (#2445). They did not fit on the development machine, so no React Native screen
  has rendered on a device yet.
- **Xcode** 15 or newer with an iOS simulator runtime, roughly 40 GB of free disk. The iOS shell
  (#2441) has been type-checked and run as a Mac Catalyst app with the Command Line Tools only;
  `xcodebuild`, the asset catalog, a simulator run and every iOS React Native step need Xcode.
- **CI runners**: macOS runners with Xcode for iOS builds and simulator tests, Linux runners with
  the Android SDK and an emulator for the shell, visual diffs and budgets. Both cost CI minutes;
  the farm.js workflows need budget for them.
- **Developer accounts**: an Apple Developer Program membership for device testing, TestFlight
  and notarization, a Google Play Console account, and a Windows code-signing certificate for
  desktop installers that do not trip SmartScreen.

### Server contract for remote clients (core, blocks mobile)

- **Origin and CSRF checks.** Farm's server-action and API protections compare the request
  `Origin` with the app's own origin. Web screens load pages from the server origin, but React
  Native and platform screens send no `Origin`. Those requests must be accepted only with a valid
  mobile token, never by relaxing origin checks for cookie sessions.
- **Token auth.** Every auth integration (Better Auth, Clerk, Auth0, WorkOS, Auth.js) needs a
  bearer-token mode with refresh, revocation and secure storage. Today they are cookie-first.
- **Absolute transport.** Server functions, API routes and route-data requests use relative URLs;
  mobile builds need one place that rewrites them to `mobile.server`, including streaming
  responses and file uploads. Native screens need route data from the same request the client
  router makes.
- **Contract manifest.** Detecting breaking changes for installed app versions, falling back to
  the web twin on a mismatch, and generating Kotlin and Swift clients all need a build-time record
  of server function names, input schemas and output schemas.

### Unknowns spikes must answer (mobile)

- **Island placement on Android.** The scroll-tracking experiment in 7.7 decides whether islands
  can scroll with the page on Android at all.
- **Native bundler.** Answered: Metro (decisions below).
- **One runtime, many surfaces.** Built in #2445: several surfaces in one shared `ReactHost`
  inside Farm's own navigator, not React Navigation, warmed after first paint. Still to answer on
  a device: a surface rendering at all (blocked on the NDK build), memory with several native
  screens on the stack, and time to first content of a warm surface.
- **React Native's size.** Measured in #2445: a debug APK with two React Native screens is 73 MB
  with unstripped libraries for two ABIs (`libreactnative.so` 24 MB and `libhermesvm.so` 4 MB per
  ABI), about 35 MB per ABI before stripping. A stripped release build per ABI is not measured yet
  and is what `budgets.appSizeMb` should be checked against.
- **WebView pool on mid-range Android.** Memory of one WebView per stacked screen, and recovery
  when the shared renderer process dies.
- **Analyzer yield.** How many real routes port (stage 0 answers) and how faithful the IR is
  (stage 1 answers). A low yield makes stages 2 to 4 a lower priority than hand-written native
  screens.

### Product and policy (maintainer decisions)

- **Store rules.** Apple requires in-app account deletion when apps create accounts, Sign in with
  Apple when other third-party sign-in is offered, a privacy manifest, and real app functionality
  beyond a website. Google Play requires a current target SDK and a data safety form. Farm can
  generate the technical parts (privacy manifest, target SDK); the policy parts are the app's.
- **Renderer scope.** Desktop, web screens and platform screens work for every renderer. React
  Native screens, `@farm.js/ui` and the analyzer are React only. This is a deliberate exception to
  Farm's renderer-neutral rule and must be stated in docs.
- **No downloaded code.** A broken native screen can be demoted to web remotely, but a fix needs a
  new build and a store release.
- **Managed hosting.** Infra does not host app servers today. Mobile without `mobile.server`
  depends on that product existing.

### Shell maturity (desktop)

- Electrobun on Windows and Linux is untested here; Linux depends on WebKitGTK, which lags the
  macOS and Windows WebViews.
- Packaged-app lifecycle: a leftover launcher process on some quits, first-launch extraction size,
  and quit events reported as cancelled while the server drains.
- Server-side dependencies must run on the embedded runtime: storage drivers with native modules
  need Bun-compatible builds (`bun:sqlite` versus `better-sqlite3`).

## Alternatives considered

### Plugins instead of config

`desktop()` and `mobile()` plugins would need to change build outputs, server defaults and CLI
commands from inside the plugin API, and two plugins could disagree about the platform. Config
keys are typed, discoverable and resolved once.

### Committed native projects from the start

Every app would carry thousands of lines of Swift, Kotlin and shell code that Farm upgrades could
not update. Generation with eject keeps the default path small and still allows full control.

### A plain WebView wrapper for mobile

Simplest to build, but navigation, back gestures, tab bars and pickers feel like a website, and
app review rejects apps that are only a wrapped site.

### React Native for every screen

One engine everywhere, as in an Expo app. Every app would pay React Native's size and startup for
routes that gain nothing from it, and would lose streaming SSR and one implementation for web and
mobile on those routes. Per-route tiers keep web screens as the default and spend native where it
wins.

### Compile all React DOM to native views

Requires every DOM and CSS feature to have a native equivalent. It does not hold for real apps and
would split behavior between platforms in ways Farm cannot test. The analyzer (7.8) instead proves
portability per route, ports only where native wins, and keeps the web twin as fallback.

### A general native-island renderer inside web screens

The 2026-10-29 draft: every shared component a native island, rendered by a React reconciler in
the WebView that sends view operations to a generated native renderer. The op protocol has prior
art (Remote DOM, remax); compositing does not. Stock Android WebView cannot put a native view into
the page's layers, so islands always float above web content and cannot be clipped, transformed
or covered (7.7). Shared components now render per tier, and islands are limited to large fixed
components.

### Reuse Capacitor's bridge and plugins

A large plugin ecosystem, but its Android bridge falls back to `addJavascriptInterface` and some
core plugins register one unconditionally, which conflicts with the bridge rules (7.10). A typed
spec with two transports also serves native screens over JSI, which a WebView-only bridge cannot.

### Run the server on the phone

Mobile OSes do not allow a long-running local HTTP server reliably, background execution is
limited, and server secrets would ship in the app binary.

## Open questions

1. **Default desktop shell.** Settled: Electrobun, resolved as `@farm.js/desktop/electrobun`.
   Electron and Tauri remain future adapters behind the same interface.
2. **Signing, notarization and auto-update.** Does Farm configure macOS notarization, Windows
   signing and update feeds, or document the shell's own tooling?
3. **Native bundler.** Decided: Metro. Revisit a Rolldown build behind the same
   `@farm.js/native/build` API only if its size win holds on a device.
4. **Mobile token mode across integrations.** Which auth integrations (Better Auth, Clerk, Auth0,
   WorkOS, Auth.js) can issue and accept bearer tokens today, and what the shared contract looks
   like in `@farm.js/integration-utils`.
5. **Old backend versions in Infra.** How managed hosting keeps a server version alive for
   installed app versions that the contract check says still depend on it.
6. **Static client assets and the guard.** Settled: the generated desktop server entry guards
   requests before Nitro, including static assets. The dev guard runs before Vite. The original
   spike used a runtime hook that ran too late; the shipped entry and desktop runtime tests cover
   this boundary.
7. **Island placement on Android.** Settled by the scroll-tracking experiment (7.7): root-flow
   islands that scroll with the page, or only placements that do not scroll.
8. **Modules and islands.** Whether Expo modules link in Farm's host (they need
   `expo-modules-core` autolinking on top of React Native's), which islands ship first-party, how
   iOS web screens get large results without an `https` handler (a native upload to a server route,
   or a size-capped inline result), and whether a Capacitor plugin adapter is worth it.
9. **Analyzer cost.** `mobile.native.auto` defaults to `"report"`, so every `farm build --mobile`
   runs stage 0. Its parse cache and per-route timings decide whether large apps need it off by
   default; `farm build` for web never runs it.
10. **Rule override document.** Its path, signing, cache lifetime, and how an app deploys it with
    its web build.

## Decision requested

Approve the platform model (the flag decides where the server runs), the `desktop` and `mobile`
config keys, the `--web`/`--desktop`/`--mobile` flags, generated-by-default native projects with
`farm eject`, the desktop local guard and shell adapter interface, the mobile screen tiers (web by
default, React Native or platform native per route), the `page.native.tsx` convention and the
`mobile.native` block, the analyzer staged from report-only, islands limited to large fixed
components, Metro for React Native screens, and the rollout order. Desktop phases 1 to 3 have
landed. Mobile phase 5, the phase 8 config surface and analyzer stage 0 were released in 0.1.50;
mobile continues with the PRs in review without changing the web path.
