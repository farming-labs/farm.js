---
title: "Mobile Apps"
description: "Ship the same Farm source as a native mobile app with farm dev --mobile and farm build --mobile."
section: "Runtime"
---

# Mobile Apps

Farm can wrap the same app you already built for the [web](/docs/deployment) into a real native
mobile app. You do not rewrite it in another UI toolkit: your existing pages become the screens,
and Farm puts a native frame around them with native tabs, a stack per tab, modal sheets, and
predictive back. (This is the [Hotwire Native](https://native.hotwired.dev) model.)

By default, every screen is just your web page shown inside that native frame. For the few routes
where a web page is not enough, you can opt one route at a time into a truly native screen, without
touching the rest of the app.

Mobile is a preview and is not released yet. **What runs today is the WebView shell on Android.**
The native screen tiers (React Native and platform-native) and iOS are designed but not built:
routes marked native render a placeholder. Every section below marks the line between what ships
now and what is still landing, so you can adopt the config surface before the runtime is complete.

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

## The screen model

Every route is a screen in the native navigator, and each route chooses **one tier** for how its
screen renders:

| Tier              | Content                                              | Added to the app                                   | Status              |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------- | ------------------- |
| **web** (default) | a WebView showing the Farm page from `mobile.server` | nothing beyond the shell, WebView pool, and bridge | **ships today**     |
| **native**        | a React Native surface (`page.native.tsx`)           | React Native (Hermes, Fabric), the screen bundle   | designed, not built |
| **platform**      | a Compose (`page.kt`) or SwiftUI (`page.swift`) view | the screen's own native code, no JS engine         | designed, not built |

Two rules hold the model together, and they are the reason it stays safe to adopt early:

- **A screen's content is one tier.** Free-form native views mixed into a web page break gestures,
  accessibility order, and keyboard handling, so they are not allowed.
- **Every route keeps its `page.tsx`.** That file is the web page, the mobile web screen, and the
  runtime fallback for the route's native screen (the "web twin" in [Design notes](#design-notes)).
  A native file with no `page.tsx` next to it is a build error.

An app pays for a native engine only when a route uses it. An app of web and platform screens ships
no JS engine beyond the system WebView.

## The files that make a screen

Each route is a folder under `src/app/`. The files you put in that folder decide how the route's
screen renders on mobile. You only ever need `page.tsx`; everything else is opt-in, for routes you
want to make more native.

Here is one route with every file it can have:

```text
src/app/feed/
  page.tsx            your normal web page                    (required)
  page.native.tsx     a native screen, written in React Native
  page.ios.tsx        the iOS version of page.native.tsx
  page.android.tsx    the Android version of page.native.tsx
  page.kt             a fully native Android screen (Kotlin + Jetpack Compose)
  page.swift          a fully native iOS screen (Swift + SwiftUI)
  layout.native.tsx   native title and tab options for this section
```

### `page.tsx` — the web screen (what you already have)

Your ordinary Farm page: React that renders HTML, styled with CSS. Every route must have one. On
mobile it shows inside the native frame as a **web screen**, the default for every route.

```tsx
// src/app/feed/page.tsx
export default function Feed({ posts }) {
  return (
    <ul>
      {posts.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  );
}
```

### `page.native.tsx` — a native screen, still written in React

The same screen, but rendered as true native UI instead of a web page. It is still React, so the
code looks familiar; what changes are the elements. Instead of HTML tags like `<div>` and `<p>`, you
use native views like `<View>` and `<Text>` from [React Native](https://reactnative.dev). Reach for
this on a route where a web page in a frame is not enough and you want native scrolling, native
inputs, or native feel, while staying in React.

```tsx
// src/app/feed/page.native.tsx
import { View, Text, FlatList } from "react-native";

export default function Feed({ posts }) {
  return (
    <FlatList
      data={posts}
      renderItem={({ item }) => (
        <View>
          <Text>{item.title}</Text>
        </View>
      )}
    />
  );
}
```

`page.ios.tsx` and `page.android.tsx` are optional per-OS versions: add one to override
`page.native.tsx` on just that platform. The other OS keeps `page.native.tsx`, or stays web if there
is none.

### `page.kt` and `page.swift` — fully native screens (no React, no JavaScript)

For the rare screen that must be 100% native, write it directly in the platform's own language and
UI toolkit: Kotlin with Jetpack Compose on Android (`page.kt`), Swift with SwiftUI on iOS
(`page.swift`). No React and no JavaScript run for these. Use them for a map, a camera view, or a
screen that leans on platform APIs.

```kotlin
// src/app/map/page.kt — Android, Kotlin + Jetpack Compose
@FarmScreen("/map")                         // bind this native screen to the /map route
@Composable
fun MapScreen(farm: FarmScreenScope) {      // Farm hands the screen a `farm` object
  val region = farm.params["region"]        // route params, same as the web page
  val places by farm.query(                 // call a Farm server function over HTTP,
    FarmServer.listPlaces(region),          //   through a generated Kotlin client
  )
  PlacesMap(places, onSelect = {
    farm.navigate("/places/${it.id}")       // navigate by URL; the navigator picks the next screen
  })
}
```

```swift
// src/app/map/page.swift — iOS, Swift + SwiftUI
@FarmScreen("/map")
struct MapScreen: View {
  @Environment(\.farm) private var farm     // the same `farm` object, on iOS
  var body: some View { PlacesMap(region: farm.params["region"]) }
}
```

**How a native screen connects to your app.** A native screen runs no JavaScript, so it cannot
import your TypeScript server functions or page code. Its whole link to the rest of the app is the
`farm` object Farm hands it:

- **`farm.params`** — the route params, exactly as the web page receives them.
- **`farm.query(...)` and server calls** — `farm build --mobile` records your server-function
  contract (every function's input and output schema) and generates a typed **Kotlin and Swift
  client** from it (that is what `FarmServer.listPlaces` is). The native screen calls that client,
  which hits the **same backend** (`mobile.server`) over the **same HTTP** as your web app, so it
  shares your exact server functions, queries, and data.
- **`farm.navigate("/path")`** — it navigates by URL, never by naming another screen. The native
  navigator (built from `farm-routes.json`) decides what the next screen is, web, native, or
  platform, the same way the web router does.

Auth is shared too (the shell keeps tokens in the Keychain or Keystore and native screens send
`Authorization: Bearer`), as are your design tokens (they compile to `Theme.swift` and `themes.xml`).
The only thing that is native is the screen's UI code; the backend, routes, auth, and theme come
from your one Farm app.

### `layout.native.tsx` — native chrome for a section

Sets the native navigation options for every screen under a folder: the large title, the header
tint, whether the tab bar shows. It styles the native frame, not the page content.

### Which file should I use?

| You want…                                                  | Add this                            |
| ---------------------------------------------------------- | ----------------------------------- |
| the normal case: one page for web and mobile               | just `page.tsx`                     |
| a native-feeling screen, written in React                  | `page.native.tsx`                   |
| that native screen, but different per platform             | `page.ios.tsx` / `page.android.tsx` |
| a fully native screen (platform APIs, maximum performance) | `page.kt` / `page.swift`            |

Whatever you add, `page.tsx` stays: it is the web version of the route and the fallback if the native
screen cannot load (the "web twin"). A native file with no `page.tsx` next to it is a build error.

> **Heads up:** the native screens above are designed but **not built yet**. Today a route marked
> native shows a placeholder on the device, not real native UI (see
> [Native screens](#native-screens) for the exact status). Web screens (`page.tsx`) are what runs
> now; the native examples show what each file will look like so the structure is clear.

## Portable components (`@farm.js/ui`)

`@farm.js/ui` gives you a small set of primitives — `View`, `Text`, `Image`, `Pressable`,
`TextInput`, and `List` — that render as **DOM on the web** and, on a mobile **native** screen, as
**native views**. The import is the same; the screen tier decides the host. This is the recommended
way to build a screen you want to work everywhere, because you write it once:

```tsx
// src/app/notes/page.tsx
import { useState } from "react";
import { View, TextInput, List } from "@farm.js/ui";
import { useServerQuery } from "@farm.js/core";
import { listNotes } from "./notes.server";

export default function Notes() {
  const [q, setQ] = useState("");
  const { data: notes = [] } = useServerQuery(listNotes, { q });

  return (
    <View padding="md">
      <TextInput value={q} onChange={setQ} placeholder="Search notes" />
      <List
        items={notes}
        row={(note) => ({ title: note.title, subtitle: note.excerpt, href: `/notes/${note.id}` })}
      />
    </View>
  );
}
```

Styling is **token props** (`padding="md"`, `background="surface"`, `radius="card"`), not arbitrary
CSS. That limit is what keeps the components portable, and it is exactly what lets the
[analyzer](#the-native-screen-report) recognize a page built from `@farm.js/ui` as one it can port to
a native screen automatically. Raw values still pass through (`padding={10}`, `background="#fff"`),
and every box-like primitive takes a `style` escape hatch.

**Status:** the **web rendering ships today**, so `@farm.js/ui` works on the web and on a mobile web
screen now. Native rendering, the same components as native views on a native screen, lands with the
native screen engine. Prefer `@farm.js/ui` over importing `react-native` directly: the raw React
Native primitives are the lower-level escape hatch, used inside a hand-written
[`page.native.tsx`](#the-files-that-make-a-screen) when you need something the portable set does not
cover.

## How a web screen renders

This is the part that runs today. The generated Android project (regenerated on every build, so
you never hand-edit it) is a plain Android Views shell, no Compose, built around three pieces.

### The native navigator

The navigator owns one stack per tab. A screen is a native bar over exactly one WebView. Pushes,
modals, replaces, and predictive back are native view transitions, not web history: tapping a tab
keeps that tab's stack, back from a second tab's root returns to the first tab, and a held back
gesture drags the screen with the finger. Links to another origin open in a Custom Tab rather than
a screen, and `file:`/`content:`/`javascript:`/`intent:` URLs are never handed to other apps.

### The WebView pool

The shell keeps **two pre-warmed WebViews**. Each one loads a warm path and installs the Farm
client router ahead of time, then sits behind the opaque tab containers so Chromium lays it out at
full size and keeps rendering frames. The pool starts only after the first tab is interactive, so
nothing competes with the first screen's cold start.

When the navigator opens a screen:

- A **warm** WebView already has the running client router, so the push is an **in-place client
  navigation** (`render(url)`), capped at ~250 ms before it gives up to a document load. This is
  what makes a push feel instant without bundled assets.
- A **cold** WebView does a full document load and shows a progress bar until first paint.
- If an in-place render throws, the screen **falls back to a full document load** of the same URL.

The pool's real win is skipping the ~1 s first-WebView startup; truly instant pushes need bundled
assets and page shells, which are part of the design but not built yet.

### The bridge

A document-start script defines `window.__farmBridge` on pages served from `mobile.server`.
Messages travel over an **origin-scoped, main-frame-only `WebMessageListener`** (named
`FarmNative`): the listener only accepts messages from the server origin on the page's main frame,
so a cross-origin iframe cannot speak to the shell. The shell deliberately does **not** use
`addJavascriptInterface`, which would reach every frame including cross-origin iframes. A WebView
without the listener runs as a plain web page.

The messages that matter:

- **`visit`** — an in-app link tap. The client hands the navigation to the shell (see below); the
  shell posts `visit`, and the native navigator decides which screen to show by the matching rule.
- **`render`** / **`rendered`** — the shell asks a warm WebView's running router to navigate to a
  URL in place, and the page replies when the frame has painted.
- **`router-ready`**, **`title`**, **`error`** — lifecycle and the document-load fallback above.
- **`call`** — a device-capability call (`native.<name>`). Reserved: no device plugins ship yet,
  so these reject as `native_unavailable`.

### Navigation delegation

The bridge does not monkey-patch the router. It uses a public, renderer-neutral core API,
[`delegateNavigation`](/docs/routing#navigation-delegates): the mobile client plugin registers a
delegate that hands each in-app navigation (`Link`, `navigateTo`, router `push` and `replace`) to
`window.__farmBridge`. The delegate runs **after navigation blockers**; returning `true` leaves the
page, URL, and history untouched so the native navigator can own the transition. Back/forward,
`refresh()`, same-page hashes, and cross-origin or locale document navigations are **not** offered,
so the WebView handles those itself. In a plain browser there is no bridge and the delegate does
nothing, so the web build is unaffected. Link prefetch is off inside the shell, since every screen
has its own WebView.

## Choosing a screen

A route's tier is decided at build time. The first source that decides wins, per route and per OS:

1. **the page export** — `export const mobile = { native: false }` forces web;
2. **`mobile.native.routes[route]`** — the OS key (`android` / `ios`) first, then `screen`;
3. **the files** next to `page.tsx` — the OS file, then `page.native.tsx`, or `page.kt` / `page.swift`;
4. **the analyzer**, only when `native.auto` is `"on"`;
5. **web.**

### Files

The files in a route folder ([The files that make a screen](#the-files-that-make-a-screen)) select
the tier. `page.tsx` is required; a native file without one is an error, and so is a React Native
file and a platform file for the same route and OS. Web and desktop builds never resolve these
files: they are not routes, not in the generated route types, and not in any web bundle.
`src/native/` is reserved for native module specs.

### Page export

A page can set its own options with a static export, read at build time with Oxc and never
executed:

```tsx
// src/app/notes/[id]/page.tsx
import type { FarmMobilePageConfig } from "@farm.js/core/mobile";

export const mobile = { presentation: "modal", prefetch: "off" } satisfies FarmMobilePageConfig;
```

`presentation` and `prefetch` (`"intent"` or `"off"`) override the config for that route.
`native: false` keeps the route web on every OS, whatever the config and files say, and warns if a
native file sits unused next to it. The values must be literals.

### `mobile.native`

| Option     | Notes                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `engine`   | `"react-native"` (default) or `"platform"`. With `"platform"`, `.native.tsx` files are an error |
| `auto`     | The build-time analyzer: `"off"`, `"report"` (default), or `"on"` (records ports, see below)    |
| `routes`   | Keyed by page route: `screen` (`web`, `native`, `platform`), `android`, `ios`, `presentation`   |
| `islands`  | Components that may render natively inside web screens, such as `["Map"]`. Reserved             |
| `prefetch` | `"intent"` (default) or `"off"`                                                                 |
| `budgets`  | `appSizeMb`, `screenOpenMs`, `droppedFrames`. Reserved for the mobile CI run                    |

`android` and `ios` override `screen` on that OS. `engine` records which toolchain a native screen
would use; `"react-native"` renders `page.native.tsx`, `"platform"` renders `page.kt` / `page.swift`
and rejects `.native.tsx` outright (there is no React Native under `"platform"`). Only `"react-native"`
and `"platform"` are valid; any other value, including `"flutter"`, fails validation. Set
`presentation` in `routes` or `native.routes`, not both.

`farm config inspect --mobile` prints each route's `screen`, the `source` that decided it (`page`,
`config`, `file`, `analyzer`, or `default`), the `module` id derived from the route (such as
`app/notes/[id]`), a `requested` tier when a route asked for native but stays web, and warnings for
a page export overriding config or a native file going unused.

## Native screens

A native screen is declared by the file next to `page.tsx` (`page.native.tsx`, `page.ios.tsx`,
`page.android.tsx`, `page.kt`, `page.swift`) or by a `mobile.native.routes` entry with
`screen: "native"` or `"platform"`. The generated Android project registers native screens by their
module id in `FarmNativeScreens`, keyed like `app/notes/[id]`.

**Status: no native engine ships yet.** Today a `native` or `platform` route is recorded in
`farm-routes.json` and shown on device as a **placeholder naming the module id** — Farm does not
build `page.native.tsx`, `page.kt`, or `page.swift` into native views. A config route that asks for
`screen: "native"` with no file **stays web and records `requested: "native"`** with a warning that
says it will become a hard error once a native renderer ships. An ejected project is where an app
registers its own screens before this lands.

The two engines, as designed:

- **`react-native`** — the default native engine. A screen renders as a React Native surface on the
  new architecture (Hermes bytecode, JSI, Fabric), with one shared JS runtime warmed lazily after
  the first native screen paints, so an app whose start screen is web pays nothing at startup.
  Screens navigate by URL, never by component, so the navigator's rules always decide the next
  screen. React only.
- **`platform`** — Kotlin/Compose on Android or Swift/SwiftUI on iOS, for screens that should run
  **no JS at all**. A platform screen adds its own native code and nothing else, and does not depend
  on the app's renderer.

Both tiers call the same server functions and route-data requests as the web client, so the data
layer is shared. See [Design notes](#design-notes) for why native is opt-in rather than the default.

## The native-screen report

Auto-porting a page to a native screen is driven by a **build-time static-analysis pass**, the
analyzer. It parses each page's source into an **abstract syntax tree** (AST) with
[Oxc](https://oxc.rs), walks that tree, and classifies every JSX element, class name, inline style,
browser API, and import against a portability model. From the parts it can map, it builds a
**platform-neutral UI tree** (an intermediate representation, or IR) that a native emitter turns into
a React Native, Compose, or SwiftUI screen.

```text
page.tsx  ──▶  AST (Oxc)  ──▶  classify every node  ──▶  decision: port or web
                                                    └─▶  portable UI tree (IR)  ──▶  [ native emitter ]
```

Today the pass stops at the report: it is **report only**, changes no output, and every analyzed
route stays a web screen. The AST walk, the classification, and the IR all run now; the emitter that
reads the IR and generates native code is the one piece not built yet, so the IR is produced but not
yet consumed.

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

Walking the AST, it visits each page, its app modules, and the layouts a `layout.native.tsx` does
not replace, and sorts what it finds into two buckets:

- **Ports:** `div`/`section`/… → View, `p`/`span`/headings → Text, `img` → Image, `button`/`a` →
  Pressable, text `input`/`textarea` → TextInput, `ul`/`ol` → List; `@farm.js/ui` and
  `@farm.js/native`; `Link`, navigation hooks, and server function hooks from `@farm.js/core`; the
  flex, spacing, size, color, border, radius, and type Tailwind subset, with `dark:`; inline styles
  with those properties; `onClick`, and input change handlers; server function modules, which the
  screen calls over the network.
- **Blocks, so the route stays web:** `canvas`, `iframe`, `video`, `table`, `svg`, `select`, `form`;
  `dangerouslySetInnerHTML`, element refs, spread props, other DOM events; stylesheet imports, grid,
  `fixed`/`sticky`, transitions, responsive and `hover:` variants, arbitrary values, runtime class
  names; `window`, `document`, storage and observer APIs, `useLayoutEffect`, `createElement`; DOM
  packages and any package not on the list; server components, async pages, and Markdown pages.

The decision is deliberately conservative: a route is **`port`** only when it has **zero blockers
and at least one win** (a rendered list, a controlled input, a timer). A portable route with no win
is reported as such and stays web, and **any doubt is web.** Every blocker is reported with its
`file:line:column`, a rule name (such as `unmapped-element` or `unknown-package`), and a message.
With `auto: "on"` a port is recorded in `farm-routes.json` as `source: "analyzer"` with
`requested: "native"`, still a web screen until an emitter ships. Facts are cached by file content
in `.farm/cache/mobile/` and keyed by the analyzer and Farm version, so the report is cheap to
re-run.

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

The shell marks each page with `data-farm-shell="android"` on `<html>` before it renders, so app
CSS can hide chrome the shell already draws, such as web tabs:

```css
html[data-farm-shell] .web-tabs {
  display: none;
}
```

Cleartext (`http://`) is allowed only under `farm dev --mobile`, for the dev server and the
emulator loopback; builds are `https://` only.

## Design notes

Mobile support is shaped by one decision: **reuse the real web pages, and spend native effort only
where it pays.** The whole design follows from that.

### The web twin and bailout

Every route keeps its `page.tsx`. It is the route's **web twin**: the web page, the mobile web
screen, and the fallback for any native screen the route later grows. That makes native adoption
reversible and gives "bailout" two independent layers:

- **Build-time (the analyzer).** A route becomes native only when it is proven portable and native
  actually wins. Anything the analyzer cannot map keeps the route on web, with the blocking line
  reported. Any doubt is web.
- **Runtime (the web twin).** A native screen that cannot be built or registered falls back to its
  web page. Today that is the whole native path: an unbuildable native request resolves to web at
  build time, and the shell shows a placeholder for a native rule with no registered screen.

### Why this shape, and not the alternatives

These were weighed and set aside (the full rationale lives in the platforms RFC, RFC 0004):

- **A plain WebView wrapper.** Simplest, but navigation, back gestures, tab bars, and pickers feel
  like a website, and app review rejects apps that are only a wrapped site. Farm draws the
  navigation chrome natively instead.
- **React Native for every screen** (Expo-style). One engine everywhere means every app pays React
  Native's size and startup for routes that gain nothing, and loses streaming SSR and one
  implementation for web and mobile. Per-route tiers keep web the default and spend native where it
  wins.
- **Compile all React DOM to native views.** This is the "render everything through one native
  layer" route (the family a Flutter-style own-canvas renderer belongs to). It requires every DOM
  and CSS feature to have a native equivalent, which does not hold for real apps and would split
  behavior between platforms in ways Farm cannot test. The analyzer instead proves portability per
  route and keeps the web twin.
- **A general native-island renderer inside web screens.** Stock Android WebView cannot composite a
  native view into the page's layers, so islands would always float above web content and could not
  be clipped or covered. Islands are therefore limited to large fixed components, and are reserved.
- **Reuse Capacitor's bridge and plugins.** Capacitor's Android bridge falls back to
  `addJavascriptInterface`, which conflicts with the origin-scoped, main-frame-only rule above, and
  a typed device spec also has to serve native screens over JSI, which a WebView-only bridge cannot.
- **Run the server on the phone.** Mobile OSes do not allow a reliable long-running local HTTP
  server, background execution is limited, and server secrets would ship in the app binary. The app
  talks to `mobile.server` instead.

### On the runtime

There is **no Farm-built JavaScript runtime** for mobile. Web screens run in the system WebView
(Chromium on Android, WebKit on iOS). The planned `native` tier runs on **React Native's own
engine** — Hermes, under its new architecture — not a Farm runtime; the `platform` tier runs
**no JS engine at all** (Compose / SwiftUI). So an app ships a JS engine on device only if it opts a
route into the React Native tier.

## What is landing

The config surface, the route manifest, the WebView shell, and the report all work today. These
parts are designed and still on the way:

- Android runs today; there is no iOS shell yet.
- `native` and `platform` screens show a placeholder naming the module id. Farm does not build
  `page.native.tsx`, `page.kt`, or `page.swift` yet; `FarmNativeScreens` in the generated project is
  where native screens will register.
- Bundled client assets and page shells (for instant pushes and an offline state) are not built;
  the shell loads pages and client code from `server`.
- Native islands (`mobile.native.islands`) and the theme-token pipeline are reserved.
- Token auth is not wired yet: the shell has no Keystore session or bearer tokens, and the server
  has no mobile-origin checks.
- Device plugins (`native.<name>`) ship none, so calls reject as unavailable.
- Apps with `experimental.serverComponents` use the RSC router, which does not hand navigations to
  the shell yet.
