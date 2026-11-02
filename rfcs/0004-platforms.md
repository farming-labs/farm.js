# RFC 0004: Platforms: one Farm source for web, desktop and mobile

- Status: Draft
- Target: 0.2
- Tracking issue: none yet
- Scope: `@farm.js/core` build and server runtime, `@farm.js/cli`, new optional packages for desktop
  shells, `@farm.js/mobile`, `@farm.js/ui` and `@farm.js/native`. Desktop, web, mobile web
  screens and platform screens (which run no JS) work with every renderer. React Native screens,
  `@farm.js/ui` and the build-time analyzer are React only.

## Status

- Desktop: merged. #2353 (core runtime primitives), #2354 (`farm dev|build --desktop`), #2355
  (Electrobun adapter), #2356 (config-only desktop example).
- Mobile, merged: #2418 (`farm dev --host`, and the default dev server answers on both loopbacks so
  an Android emulator can reach it), #2419 (`delegateNavigation`, which the shell uses to take
  in-app navigations).
- Mobile, in review: #2420 (`mobile` config block, generated `farm-routes.json`,
  `farm config inspect --mobile`), #2422 (`@farm.js/mobile` Android shell with web screens,
  `farm dev|build --mobile`). The Android spike #2390 stays a draft.
- #2420 ships `mobile.routes[x].native: "<module>"` from the previous draft. This revision moves
  native screens to `page.native.tsx` and `mobile.native.routes` (7.3), so that field changes
  before or right after #2420 merges.
- Revised 2026-11-01: mobile screens come in tiers chosen per route (web by default, React Native
  or platform native), `page.native.tsx` selects a native screen, a `mobile.native` config block
  and an optional build-time analyzer decide the rest, and native islands are narrowed to large
  fixed components. This replaces the 2026-10-29 rule that shared components are always native
  islands on mobile.

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
`farm build --preset bun` output runs unmodified inside Electrobun's bundled Bun, and SSR,
hydration, API routes, server functions and `node:fs` all work in WKWebView. It also needed about
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
    version: (await import(`${root}/package.json`)).version,
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
  `/.well-known/*`, Markdown mirrors).
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

`desktop.shell` accepts a name (`"electrobun"`, `"electron"`, `"tauri"`) resolved to
`@farm.js/desktop-<name>`, or a package name for third-party shells. It does not accept an adapter
object: importing an adapter in `farm.config.ts` would pull it into web server bundles for apps
whose config is bundled. Electrobun ships first. Electron (`runtime:
"node"`, in-process in the main process) and Tauri (Bun server as a sidecar) follow.

### 6.7 Desktop output

```text
.farm/output/desktop/
  server/            Farm server for the shell runtime (entry.mjs, chunks, public/)
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

- Content-hashed client assets are bundled into the app and served by a local scheme handler
  (`WebViewAssetLoader` on Android, `WKURLSchemeHandler` on iOS) on an https origin, so only HTML
  and data cross the network.
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

One typed spec, one implementation per OS, two transports, one app-facing API.

```text
src/native/haptics.ts            spec, React Native Codegen style
src/native/haptics.android.kt    implementation, written once per OS
src/native/haptics.ios.swift
  generated: TS types, Kotlin and Swift interfaces, JSI glue, bridge dispatcher
  native screens: TurboModule over JSI, direct calls
  web screens:    origin-scoped async bridge, JSON messages
```

```ts
// src/native/haptics.ts
import { defineNativeModule } from "@farm.js/native/spec";

export interface Spec {
  impact(style: "light" | "medium" | "heavy"): Promise<void>;
  selection(): Promise<void>;
}

export default defineNativeModule<Spec>("Haptics");
```

```ts
// in a web screen, a native screen, or a web or desktop build
import { native } from "@farm.js/core/native";

await native.haptics.impact("light");
const photo = await native.camera.takePhoto({ quality: 0.8 });
```

- Specs use React Native Codegen's type subset: primitives, string unions, objects, arrays,
  `Promise` results and event emitters. Methods must be async, because the web-screen transport is.
  A synchronous method is a spec error, so the API is the same on both transports.
- Both transports validate arguments against the spec on the native side before the
  implementation runs.
- First-party modules (camera, share, biometrics, push, haptics) use the same format.
  `mobile.modules` enables them and writes their permission strings
  (`mobile.modules.camera.usage` becomes `NSCameraUsageDescription` and the Android permission
  entry). App modules in `src/native/` are enabled by existing.
- `native` is a typed proxy generated into `.farm/types/native.d.ts`. Where a web fallback exists
  (`<input type="file" capture>`, `navigator.share`) web and desktop use it; other calls reject
  with a typed `NativeUnavailableError`, and `native.<module>.available()` checks first.
- Farm does not reuse Capacitor's bridge. Its Android fallback to `addJavascriptInterface`, and
  plugins that register one unconditionally, conflict with the bridge rules in 7.10. A Capacitor
  plugin adapter is an open question.

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

- Visual diff in CI: for each ported route, the web screen and the native screen render on an
  emulator with the same fixture data and are compared. A difference over the threshold demotes the
  route to web, and the report says why.
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

Open: the bundler for React Native screens. Metro is what React Native libraries and Fast Refresh
are tested against. A Rolldown-based bundle keeps one toolchain with the web build (Oxc transforms,
Farm's plugin pipeline). A spike decides, comparing build time, bundle size, Fast Refresh, Hermes
bytecode output and how many common React Native libraries work unchanged.

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
    screens.hbc          React Native screens, Hermes bytecode
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

- **self-hosted**: `mobile.server` is the URL of any `--web` deployment of the same app; or
- **managed**: Farm.js Infrastructure deploys the Farm server for the app ("deploy my Farm
  server"). This is a future Infra product and out of scope for the first implementation.

Rules that hold either way:

- **Auth uses tokens.** Tokens live in the Keychain (iOS) or Keystore (Android). The shell sets the
  session cookie on the WebView cookie store for the server origin at launch and after refresh;
  native and platform screens send `Authorization: Bearer`. Auth integrations need a token mode
  (issue, refresh and accept bearer tokens) for this to work.
- **The server-function contract is recorded per build.** `farm build --mobile` writes the
  server-function and route-data signatures, with input and output schemas, into the app and into
  the server build. A web deploy that removes or incompatibly changes a function still called by an
  installed app version fails the check with the affected versions. The same schemas generate the
  Kotlin and Swift clients for platform screens.
- **Optional minimum version.** `mobile.minimumVersion` lets the server reject older apps with a
  response the shell turns into an update prompt.

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
| Native features  | web APIs            | shell APIs (menu, tray, dialogs) | typed native modules through `native` (7.5)                  |
| Native islands   | DOM                 | DOM                              | `Map`, `Video`, `CameraPreview` when listed (7.7)            |
| Auth             | cookies             | cookies, local guard             | Keychain/Keystore tokens                                     |
| Store acceptance | n/a                 | signing and notarization (open)  | native navigation and chrome (see 7.1)                       |

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

5. **Android web screens.** `farm dev --host` (#2418, merged), `delegateNavigation` (#2419,
   merged), the `mobile` block and `farm-routes.json` (#2420, in review), the `@farm.js/mobile`
   Android shell with `farm dev|build --mobile` (#2422, in review).
6. **Production web screens.** Bundled assets and page shells, token auth, server origin handling,
   absolute transport, the contract manifest, the remote rule override, and the iOS shell.
7. **Native modules.** Spec format and codegen, the bridge transport, first-party modules,
   `@farm.js/ui` pop-ups and chrome on web screens. Analyzer stage 0 (report only) lands here; it
   needs no native engine.
8. **React Native screens.** `page.native.tsx` and OS overrides, `layout.native.tsx`, the
   `mobile.native` block, the shared pre-warmed runtime, Hermes bytecode, intent prefetch, the
   TurboModule transport, the web twin fallback and budgets in CI. The Metro or Rolldown spike runs
   first. Analyzer stages 1 and 2.
9. **Native islands**: `Map`, `Video`, `CameraPreview`, after the scroll-tracking experiment
   (7.7) decides their Android placement.
10. **Analyzer stage 3**: `auto: "on"`.
11. **Platform screens** (`page.kt`, `page.swift`, `@FarmScreen`) and analyzer stage 4.

Both:

12. **Docs and examples**, landing with each phase.

Managed backend hosting in Infra comes after phase 6. iOS needs macOS CI with Xcode, and Android
needs Linux CI with the Android SDK and an emulator, before the matching phase ships.

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

- **Android SDK and emulator** are in use: #2422 was verified on an Android 15 emulator. **Xcode**
  with iOS simulator runtimes is still needed before iOS work can start, with roughly 40 GB of free
  disk.
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
- **Native bundler.** Metro or a Rolldown-based React Native bundle (7.9).
- **One runtime, many surfaces.** Hosting several Fabric surfaces in one shared runtime inside
  Farm's own navigator, not React Navigation, with pre-warm after first paint.
- **React Native's size.** What Hermes and Fabric add to the app, measured against
  `budgets.appSizeMb`, since the first native route pays for it.
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

1. **Default desktop shell.** Electrobun is smaller and Bun-native; Electron has a larger
   ecosystem, Chromium everywhere and mature auto-update. The adapter interface does not depend on
   the answer.
2. **Signing, notarization and auto-update.** Does Farm configure macOS notarization, Windows
   signing and update feeds, or document the shell's own tooling?
3. **Native bundler.** Metro or a Rolldown-based React Native bundle. A spike decides (7.9).
4. **Mobile token mode across integrations.** Which auth integrations (Better Auth, Clerk, Auth0,
   WorkOS, Auth.js) can issue and accept bearer tokens today, and what the shared contract looks
   like in `@farm.js/integration-utils`.
5. **Old backend versions in Infra.** How managed hosting keeps a server version alive for
   installed app versions that the contract check says still depend on it.
6. **Static client assets and the guard.** Nitro serves client chunks before Farm's runtime hooks,
   so the spike's guard did not cover them. They contain only client code, but the desktop server
   entry could put the guard in front of static serving for uniformity.
7. **Island placement on Android.** Settled by the scroll-tracking experiment (7.7): root-flow
   islands that scroll with the page, or only placements that do not scroll.
8. **Module and island catalog.** Which native modules and islands ship first-party, how third
   parties publish a spec with its Kotlin and Swift implementations, and whether a Capacitor plugin
   adapter is worth it.
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
components, and the rollout order. Desktop phases 1 to 3 have landed; mobile continues with phase
5 without changing the web path.
