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

Mobile is a preview, released in Farm 0.1.50 with `@farm.js/mobile` 0.1.0-beta.0. **What runs
today is the WebView shell on Android.** The iOS shell generates an Xcode project but has not been
built with `xcodebuild` yet (see [Run on iOS](#run-on-ios)). React Native screens (not released
yet) run under `farm dev --mobile` on an Android emulator only; a production (Hermes bytecode) build
and real devices are not verified yet. Platform-native screens are designed but not released:
platform routes render a placeholder. Every section below marks the line between what ships now and
what is still landing, so you can adopt the config surface before the runtime is complete. The
design and rollout are in [RFC 0004](https://github.com/farming-labs/farm.js/pull/2352).

```sh
farm dev --mobile             # dev server, Android project, install and open on a device
farm build --mobile           # mobile client build and Android project
farm dev --mobile --os ios    # dev server, Xcode project, build and open on a booted simulator
farm build --mobile --os ios  # mobile client build and Xcode project
farm build                    # --web, the default, unchanged
```

## Status

| Part                                          | Status                         | Notes                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android shell with web screens                | **Preview, shipped in 0.1.50** | Tabs, stacks, modals, predictive back, the WebView pool, and the bridge                                                                                                       |
| `mobile` config, screen files, route manifest | **Shipped in 0.1.50**          | `native` and `platform` routes are recorded in `farm-routes.json` and show a placeholder                                                                                      |
| Native-screen analyzer                        | Unreleased                     | Sorts routes into tiers; proven native-tier routes become `server` screens with `native: true` or `auto: "on"`                                                                |
| Generated React Native ports                  | Unreleased                     | Android: emitted from portable pages with `auto: "on"`; run on an emulator, not yet on a device. See [Generated ports](#generated-react-native-ports)                         |
| Server-rendered native screens (`server`)     | Unreleased, Android            | Drawn with Android views from the page the server renders; run on an emulator under `farm dev --mobile`, not yet on a device. iOS shows them as web screens                   |
| iOS shell                                     | Unreleased                     | Generates an Xcode project; not yet built with `xcodebuild` (see [Run on iOS](#run-on-ios))                                                                                   |
| React Native screens                          | Unreleased, dev only           | Android only; runs under `farm dev --mobile` on an emulator, not yet in a production build or on a device (see [React Native screens](#react-native-screens))                 |
| Bundled client assets                         | Unreleased                     | Pages in a production shell run the mobile client; Android serves its files from the APK, iOS from the server (see [Bundled client assets](#bundled-client-assets))           |
| Page shells                                   | Unreleased                     | `mobile.shells`: a route's layout and loading state, shown before its document and while offline; not yet run on an emulator or simulator (see [Page shells](#page-shells))   |
| Signed-in native screens (device tokens)      | Unreleased                     | Android shell run on an emulator under `farm dev --mobile`; iOS not yet built with Xcode (see [Auth on mobile](#auth-on-mobile))                                              |
| Server components apps                        | Unreleased                     | Both engines get the mobile client; islands mode also gets device tokens, the RSC pipeline does not (see [Bundled client assets](#bundled-client-assets)); no page shells yet |
| Platform screens (`page.kt`, `page.swift`)    | Planned                        | Show a placeholder                                                                                                                                                            |
| Native islands and native `@farm.js/ui`       | Planned                        | `mobile.native.islands` is reserved; `@farm.js/ui` renders on the web only (see [Portable components](#portable-components-farmjsui))                                         |
| Device modules (`native.<name>`)              | Planned                        | Calls reject as unavailable                                                                                                                                                   |

## Requirements

| For                               | You need                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Android (shipped)                 | JDK 17 or newer (tested with JDK 21), and the Android SDK with platform 35, build-tools 35, and platform-tools; set `ANDROID_HOME`           |
| Running on Android                | An emulator or a device with Android 8.0 (API 26) or newer, listed by `adb devices`                                                          |
| React Native screens (unreleased) | Also the Android NDK 27.1.12297006 and CMake 3.22.1, which Gradle installs on the first build once the SDK licenses are accepted             |
| iOS (unreleased)                  | A Mac with Xcode, the iOS 16 or newer SDK, and an iOS simulator runtime; the Command Line Tools alone are not enough. The app targets iOS 16 |

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
| `shells` | `true` bundles [page shells](#page-shells) in `farm build --mobile`. Defaults to `false`        |

Tabs and route keys are checked against the app. A web build never calls or checks the block and
strips it from the server, as it does `desktop`. It also builds the
[mobile client](#bundled-client-assets): the web client's files stay byte-identical to the same
app without the key, and the build adds the mobile client's files. The
web server gains the session endpoints native screens sign in through (see
[Auth on mobile](#auth-on-mobile)). Every `mobile` block, static or a function, builds the same
output, and an app without one gets no mobile client, no shell handling, no session route, and no
hook.

```sh
farm config inspect --mobile --os ios --profile beta   # block, screens, and farm-routes.json
```

## The screen model

Every route is a screen in the native navigator, and each route chooses **one tier** for how its
screen renders:

| Tier              | Content                                              | Added to the app                                   | Status                |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------- | --------------------- |
| **web** (default) | a WebView showing the Farm page from `mobile.server` | nothing beyond the shell, WebView pool, and bridge | **ships today**       |
| **native**        | a React Native surface (`page.native.tsx`)           | React Native (Hermes, Fabric), the screen bundle   | Android, dev verified |
| **platform**      | a Compose (`page.kt`) or SwiftUI (`page.swift`) view | the screen's own native code, no JS engine         | designed, not built   |

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

> **Heads up:** most of the native screens above are designed but **not built yet**.
> `page.native.tsx` runs as a React Native screen only under `farm dev --mobile` on an Android
> emulator; `page.kt` and `page.swift` routes, and `page.native.tsx` routes on iOS, show a
> placeholder (see [Native screens](#native-screens) for the exact status). Web screens
> (`page.tsx`) are what runs now; the other examples show what each file will look like.

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

The pool's real win is skipping the ~1 s first-WebView startup. In a `farm build --mobile` app the
client JS also comes from the APK ([below](#bundled-client-assets)), and with `mobile.shells` a cold
load shows the route's [page shell](#page-shells) before the server answers.

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

### Bundled client assets

Pages always come from `mobile.server`, so server rendering, auth, and data work as on the web.
What a page loads decides how it behaves in the shell: the **mobile client** (`platform()` is
`"mobile"`, and its router hands navigations to the native navigator) or the web client (links
navigate inside the WebView).

- **The web build adds the mobile client.** `farm build` of an app with a `mobile` block builds
  the client a second time for mobile and deploys it next to the web client. An app without a
  `mobile` block builds exactly what it did before.
- **The shell asks for it.** Every document load the shell starts carries `X-Farm-Shell: android`
  (or `ios`). For such a request the server points the page at the mobile client, sends it
  `Cache-Control: private, no-store`, and every HTML response gets `Vary: X-Farm-Shell`, so a
  cache never hands one variant to the other.
- **Android serves the files from the APK.** `farm build --mobile` makes the same build and
  copies the mobile client's content-hashed files into the app (`assets/farm-www`, listed in
  `assets/farm-assets.json`). The shell answers a request on the server's origin from the APK only
  when its exact path is listed; a hashed name only ever has those bytes, so the copy is the file
  the server would send. Only the document and data cross the network.
- **A newer deployment still works.** Its documents reference new hashed names that the installed
  app does not have, and those load from the server (logged as
  `assets: /chunks/... is not bundled; loading it from the server`). The page always runs the
  client its own deployment built, so an old app never runs an old client against a new server.
- **iOS loads the mobile client from the server.** `WKWebView` cannot answer `https` requests
  from the app (a `WKURLSchemeHandler` only takes custom schemes), so iOS gets native navigation
  but not bundled files; WebKit caches them after the first load.

```sh
farm build                       # deploy this: web client + mobile client
farm build --mobile --apk        # the same build; its mobile client goes into the APK
```

Build the app from the same source and environment as the deployment, and the names match. When
they don't, the app still works and loads every file from the server.

Limits:

- Prerendered pages (`"use ssg"`) are static files the server never sees, so in a shell they load
  the web client, and their links navigate in place.
- Server components apps (`experimental.serverComponents`) get a mobile client too. In islands
  mode it is the same mobile client as any app's. On the RSC pipeline the build adds one entry,
  `farm-mobile-client`, that hands navigations to the shell and then runs the web entry, so the
  two share every chunk and `.farm/mobile-client.json` lists the client build's files with
  `clientDir`. There `platform()` is `"web"` in both, and pages do not take the WebView pool's
  in-place renders (the bridge renders through Farm's SPA router), so each push loads its
  document.
- Both clients share the web build's stylesheet.
- A document the WebView loads by itself has no header and gets the web client. The shells load
  router fallbacks and reloads again with the header, iOS also redirects, and Android's WebView
  keeps the header across a server redirect; a form post's response keeps the web client until
  the next navigation.

### Page shells

A cold document load (a tab's first screen, a push when the pool is empty, the web twin of a
native screen) waits for the server's document. With `shells: true`, `farm build --mobile` bundles
a **page shell** per route: the route's layouts around its `loading.tsx`, as HTML with no scripts.
The shell shows at once, and stays up when the server cannot be reached.

```ts
export default defineConfig({
  mobile: {
    id: "com.example.notes",
    server: "https://notes.example.com",
    shells: true,
  },
});
```

```text
src/app/layout.tsx              the app chrome
src/app/notes/layout.tsx        the notes chrome
src/app/notes/loading.tsx       the notes skeleton
src/app/notes/page.tsx          /notes        shell: both layouts around the skeleton
src/app/notes/[id]/page.tsx     /notes/[id]   the same shell file
```

Adding `src/app/notes/[id]/layout.tsx` would take `/notes/[id]`'s shell away: that layout sits in a
dynamic folder.

- **Which routes get one.** A shell is the same HTML for every URL of a route, so nothing in it may
  depend on a param: a route gets one when its nearest `loading` file and every layout around the
  page sit in folders without `[params]`. Routes without a loading file get none. The build prints
  the routes that have a loading file and still get no shell, with the reason.
- **How it is rendered.** `farm build --mobile` builds its server with a random token, starts it on
  a loopback port, and asks it for each route. That server, and only it, answers a request with the
  token by rendering the layouts around the loading file, with no params, route data, slots, or
  page metadata. The web build's server has no such mode. Middleware and guards run as for any
  request, so a route they redirect gets no shell, and the request carries no cookies, so a shell
  shows the signed-out layout.
- **What is kept.** Every script and script preload is removed, and so are the links that name
  the page's URL (`canonical`, the locale and markdown alternates). `<html>` gets
  `data-farm-page-shell`, and each shell is named by its content hash, so routes with the same
  shell share one file. Android keeps the stylesheet link and serves it from the APK; iOS inlines
  the build's stylesheets, since `loadHTMLString` has no bundled files to load them from.
- **Android** shows the shell in a WebView without JavaScript over the screen's page while the
  document loads, and removes it when the page first paints. When the server cannot be reached,
  the shell stays instead of an error page.
- **iOS** loads the shell into the screen's WKWebView with `loadHTMLString` at the document's URL,
  then loads the document, which WebKit shows once it commits. When the load fails, the shell
  stays under the retry message.
- **A warm push never shows one.** The pooled page's running router renders the route in place,
  which is already faster than a document load.
- **Another client build turns them off.** The shells match the client they were built with. When a
  document loads a different mobile client (a deployment newer or older than the app), the app
  stops showing shells, remembers that across launches, and shows them again once a document loads
  its own client.

```css
/* A shell renders signed out; keep its account menu from flashing "Sign in". */
html[data-farm-page-shell] .account-menu {
  visibility: hidden;
}
```

Limits: only `farm build --mobile` bundles shells (`farm dev --mobile` has none); a shell renders
the default locale; layouts that read cookies or headers render as for a signed-out visitor; on
iOS the shell is an entry in the WebView's history, so a page that calls `history.back()` from its
first document returns to it; apps with `experimental.serverComponents` get the mobile client but
no shells yet, since the RSC server has no shell mode (`farm build --mobile` warns).

### Navigation delegation

The bridge does not monkey-patch the router. It uses a public, renderer-neutral core API,
[`delegateNavigation`](/docs/routing#navigation-delegates): the mobile client plugin registers a
delegate that hands each in-app navigation (`Link`, `navigateTo`, router `push` and `replace`) to
`window.__farmBridge`. The delegate runs **after navigation blockers**; returning `true` leaves the
page, URL, and history untouched so the native navigator can own the transition. Back/forward,
`refresh()`, same-page hashes, and cross-origin or locale document navigations are **not** offered,
so the WebView handles those itself. In a plain browser there is no bridge and the delegate does
nothing, so the web build is unaffected. On the RSC pipeline the RSC router offers link clicks
(`Link replace` as `"replace"`), `router.push` and `replace`, and redirects after a server action
the same way. Link prefetch is off inside the shell, since every screen
has its own WebView.

## Choosing a screen

A route's tier is decided at build time. The first source that decides wins, per route and per OS:

1. **the page export** — `export const mobile = { native: false }` forces web, and
   `{ native: true }` requires a native screen ([below](#requiring-a-native-screen));
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

### Requiring a native screen

`export const mobile = { native: true }` makes a native screen a requirement instead of a hope: the
route needs a native file next to the page, or the analyzer must find the page in the **native**
tier ([tiers](#tiers)). Otherwise `farm dev --mobile` and `farm build --mobile` fail and name every
blocker:

```text
mobile (os: android): src/app/page.tsx sets mobile.native to true, but "/" cannot render as a native screen:
  - src/app/page.tsx:4:19 useState() runs on the device
It needs JavaScript on the device: add page.native.tsx next to the page, or remove mobile.native.
```

The check runs on every dev start and build, whatever `native.auto` is. A passing route becomes a
`server` screen ([Server-rendered native screens](#server-rendered-native-screens)).

### `mobile.native`

| Option     | Notes                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `engine`   | `"react-native"` (default) or `"platform"`. With `"platform"`, `.native.tsx` files are an error  |
| `auto`     | The build-time analyzer: `"off"`, `"report"` (default), or `"on"` (applies its tiers, see below) |
| `routes`   | Keyed by page route: `screen` (`web`, `native`, `platform`), `android`, `ios`, `presentation`    |
| `islands`  | Components that may render natively inside web screens, such as `["Map"]`. Reserved              |
| `prefetch` | `"intent"` (default) or `"off"`                                                                  |
| `budgets`  | `appSizeMb`, `screenOpenMs`, `droppedFrames`. Reserved for the mobile CI run                     |

`android` and `ios` override `screen` on that OS. `engine` records which toolchain a native screen
would use; `"react-native"` renders `page.native.tsx`, `"platform"` renders `page.kt` / `page.swift`
and rejects `.native.tsx` outright (there is no React Native under `"platform"`). Only `"react-native"`
and `"platform"` are valid; any other value, including `"flutter"`, fails validation. Set
`presentation` in `routes` or `native.routes`, not both.

`farm config inspect --mobile` prints each route's `screen`, the `source` that decided it (`page`,
`config`, `file`, `analyzer`, or `default`), the `module` id derived from the route (such as
`app/notes/[id]`), a `requested` tier when a route asked for native but stays web, and warnings for
a page export overriding config or a native file going unused.

## Server-rendered native screens

A route in the analyzer's **native** tier ([tiers](#tiers)) needs no JavaScript on the device, so it
does not need React Native either. With `export const mobile = { native: true }` on the page, a
config route with `screen: "native"` and no native file, or `native.auto: "on"`, it is recorded in
`farm-routes.json` as `screen: "server"`, and the shell draws it with plain platform views:

```text
shell ── GET /notes, Accept: application/vnd.farm.native+json ──▶ web server
                                                                   renders /notes as for a browser
shell ◀── { root: { type: "View", children: [...] } } ─────────── reads the HTML into a tree
```

- **Data and auth stay on the server.** The server renders the page through its normal request
  path, middleware and guards included, with the WebViews' cookies. Async pages and server
  components work, since they run on the server as for the web page.
- **Only the page.** The tree is the page's own content: the layouts are web chrome, and the native
  shell draws the bar and tabs.
- **Styles map at build time.** Tailwind classes resolve to native values from Tailwind's default
  theme (colors from oklch to sRGB, spacing, type, radius); `dark:` variants follow the system
  theme; text styles flow down as CSS inheritance does. The analyzer only lets a class through when
  the tree can resolve it.
- **The app's own CSS applies too.** The server reads the stylesheets the page links, as the
  browser gets them (in production, the client CSS the build embedded), and cascades their rules:
  type, class, id, and attribute selectors, compounds, descendant, child, and sibling combinators,
  `:first-child` and `:last-child`, specificity and source order, `:root` variables with `var()`,
  and `@media (prefers-color-scheme: dark)`. Shorthands such as `margin: 8px 0 4px` and
  `border: 1px solid var(--border)` expand, and `background: none` or its minified `0 0` clears the
  color; `:hover` and `:focus` rules never match a static
  screen; `body` passes its text styles down and gives the screen its background. Rules in
  `@layer` are Tailwind's and left to the table above. Another `@media`, an unknown pseudo-class,
  or a declaration with no native style is reported in `unsupported`. The analyzer reads the plain
  `.css` files the route imports with the same rules, so a class only passes the native tier when
  the app's CSS styles it in a way the tree can draw.
- **Any doubt is web.** The response lists what it could not express in `unsupported`; the shell
  then shows the route's web screen, as it does for a failed request or an answer that is not a
  tree, such as a redirect to sign in.

Drawn on Android: `View` (flex column or row, gap, padding, margins, width and height in px or
`100%`, `flex-1`, alignment, `max-w-*`), `Text` with inline runs (links, `<strong>`, `<em>`,
`<code>`), `Image`, links and buttons as pressable boxes, and borders, radii, backgrounds, and
opacity, and wrapping rows (`flex-wrap: wrap`). Not yet: percentages other than `100%`, wrapping
columns, absolute or sticky positioning, Sass and other non-CSS stylesheet sources in the analyzer,
forms, and inputs that do anything. iOS shows `server`
routes as web screens until the iOS shell draws them.

A web server answers these requests only for an app with a `mobile` block, so a web-only app's
server is unchanged.

`examples/mobile` sets `native.auto: "on"`. Seven of its routes are `server` screens (`/`,
`/notes`, `/notes/[id]`, `/about`, `/feed`, `/navigation/step/[n]`, `/docs/[...slug]`), and its
`pnpm smoke` checks that each one's tree converts with nothing in `unsupported` against the
production server. The routes with client-side state stay web.

## Native screens

A native screen is declared by the file next to `page.tsx` (`page.native.tsx`, `page.ios.tsx`,
`page.android.tsx`, `page.kt`, `page.swift`) or by a `mobile.native.routes` entry with
`screen: "native"` or `"platform"`. The generated Android project registers native screens by their
module id in `FarmNativeScreens`, keyed like `app/notes/[id]`.

**Status: React Native screens run under `farm dev --mobile` on an Android emulator; production
builds and real devices are not verified yet** ([below](#react-native-screens)). A `platform`
route is recorded in `farm-routes.json` and shown on device as a **placeholder naming the module
id**: Farm does not build `page.kt` or `page.swift` yet.
A config route that asks for `screen: "native"` with no file gets a
[generated port](#generated-react-native-ports) on Android when the page passes the analyzer and the
emitter; otherwise it **stays web and records `requested: "native"`** with a warning that says why.
An ejected project is where an app registers its own platform screens before they land.

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

### React Native screens

A `page.native.tsx` (or `page.android.tsx`) next to a route's `page.tsx` is built as a React Native
screen for the Android shell. Treat this tier as experimental. Install React Native, its Metro
config, and `@farm.js/native` as dev dependencies; a web build never resolves any of them:

```sh
pnpm add -D @farm.js/native react-native@^0.88 @react-native/metro-config@^0.88
pnpm add react@^19.2.8 react-dom@^19.2.8
```

`@farm.js/native` needs React 19.2.8 or later. React Native 0.88 declares a `react@^19.3.0` peer
(its renderer is built from React 19.3.0), so on 19.2.8 your package manager warns, but the mobile
example runs its native screens on 19.2.8 with one React in the dev bundle. That is verified in dev,
not yet in a production build. Web pages and native screens bundle the app's one `react`, so keep
`react` and `react-dom` on a single version.

What is verified, in `examples/mobile` under `farm dev --mobile` on an Android 15 emulator
(SwiftShader software rendering, no GPU):

- `page.native.tsx` and `page.android.tsx` screens render as React Native with data from API routes.
- A push from a native screen to a web screen takes 120 to 134 ms, and the back gesture returns to
  the native screen. A web modal opened from a native screen closes on back. Tabs work.
- Fast Refresh works.
- Cold start takes 1.4 to 2.9 s, with 84 to 198 ms of main-thread startup work. The React Native
  runtime warms up 1.2 to 5.0 s after the first paint, loading its bundle from Metro. The first
  `/map` open takes 611 to 1413 ms (103 to 797 ms on later opens), the first `/camera` open 184 to
  205 ms.

Not verified yet: native screens in a production build (a bytecode build installs and cold-starts,
but no native screen was opened in it), and real devices, so the emulator numbers say nothing about
smoothness on a phone.

```tsx
// src/app/map/page.native.tsx
import { serverFetch, useNavigate, useServerQuery } from "@farm.js/native";
import { useState } from "react";
import { FlatList, Pressable, Text } from "react-native";

async function listStations(): Promise<Array<{ id: string; name: string }>> {
  const response = await serverFetch("/api/stations");
  return response.json();
}

export const metadata = { title: "Map" };

export default function MapScreen() {
  const navigate = useNavigate();
  const { data = [], refetch } = useServerQuery(listStations, undefined);
  // `pending` is true only for the first load, so pull-to-refresh tracks its own state.
  const [refreshing, setRefreshing] = useState(false);
  return (
    <FlatList
      data={data}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        refetch()
          .catch(() => {})
          .finally(() => setRefreshing(false));
      }}
      renderItem={({ item }) => (
        <Pressable onPress={() => navigate(`/stations/${item.id}`)}>
          <Text>{item.name}</Text>
        </Pressable>
      )}
    />
  );
}
```

| `@farm.js/native`             | Notes                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `useNavigate()`               | `navigate(href, { replace })` by URL; the navigator picks the next screen, web or native                                             |
| `useRouteParams()`            | Route params, such as `{ id: "7" }` for `/notes/[id]`, after the base path and locale prefix                                         |
| `useServerQuery(fn, input)`   | Runs any async `fn(input)` on mount and when `input` changes: `{ data, error, pending, refetch }`                                    |
| `serverFetch(path, init)`     | `fetch` against `mobile.server` (the dev server under `farm dev --mobile`), with the base path and the device session once signed in |
| `signOut()`                   | Low-level "forget this device": revoke its token, delete it, clear the WebView cookies                                               |
| `serverUrl(path)`             | The absolute URL of a path on `mobile.server`                                                                                        |
| `export const metadata.title` | The native bar's title                                                                                                               |

Native screens call the same API routes as the web client, over HTTP to `mobile.server`. They send
no cookies. Once the user has signed in on a web screen, `serverFetch` sends the device's session
token, so protected routes see the same user (see [Auth on mobile](#auth-on-mobile)). A screen
navigates by URL only, so `farm-routes.json` always decides what
opens next: a link from a native screen can open a web screen, a modal, a tab, or another native
screen, and back returns to it.

- **Build.** `farm build --mobile` writes one entry that registers every native screen under its
  module id, bundles it with Metro, and compiles it to Hermes bytecode with the `hermesc` that
  ships with the app's `react-native`. The bytecode is the only JS a release app runs; no code is
  downloaded.
- **Dev.** `farm dev --mobile` starts Metro next to the dev server (port 8081, or the next free
  one) and the debug app loads the screens from it, with Fast Refresh.
- **Runtime.** React Native's new architecture only: Hermes, Fabric, bridgeless. One runtime is
  shared by every native screen, each its own surface. It starts after the first screen shows
  content, so a web start screen pays nothing at launch.
- **Web twin.** If the runtime fails to start, the bundle is missing or broken, or a screen throws
  while loading or rendering, the navigator shows the route's `page.tsx` in a WebView instead and
  logs the reason (`adb logcat -s FarmShell`). A screen whose module throws while loading logs
  `<module id> failed to load: <error>`, such as
  `app/map failed to load: ReferenceError: stations is not defined`. That is the build behavior. In
  dev, Metro reports a module that throws while loading as fatal, so React Native's error screen
  shows the error instead of hiding it behind the web page.
- **Cost.** An app pays for React Native only when a route resolves to a native screen. Without
  one, the generated project has no React Native dependency, Kotlin, or asset. With one, the
  project adds `react-android` and `hermes-android`, compiles with Kotlin 2.2, bundles the screens'
  bytecode, and builds one small native library (`libappmodules.so`) that React Native needs to
  reach its core modules. In numbers:
  - The first Gradle build downloads about 400 MB of React Native AARs.
  - `libappmodules.so` (73 KB) needs the Android NDK 27.1.12297006 (2.4 GB) and CMake 3.22.1
    (94 MB), which Gradle installs on the first build once the SDK licenses are accepted
    (`sdkmanager --licenses`).
  - The debug APK is about 73.7 MB, unstripped.
  - The example's screen bundle compiles to 1.23 MB of Hermes bytecode (Metro 18.5 s, `hermesc`
    1.6 s).
  - Only the 64-bit ABIs are built (`arm64-v8a`, `x86_64`), so 32-bit devices are not supported.

Native files import `react-native`, which a web-only checkout may not have. Keep them out of the
web type-check and check them on their own:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    /* ... */
  },
  "include": ["src"],
  "exclude": ["src/**/*.native.tsx", "src/**/*.android.tsx", "src/**/*.ios.tsx"],
}
```

```jsonc
// tsconfig.native.json: tsc -p tsconfig.native.json, once react-native is installed
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "lib": ["ESNext"], "customConditions": ["react-native"] },
  "include": ["src/**/*.native.tsx", "src/**/*.android.tsx", "src/**/*.ios.tsx"],
  "exclude": [],
}
```

## Native device features

A phone has capabilities a browser does not — the camera, SMS, contacts, sensors, push. Here is the
honest state of reaching them from a Farm app today, and where it is headed.

**Nothing ships automatically.** The generated app declares only the `INTERNET` permission, and the
WebView is given no device APIs, so there is no `native.camera` or `native.sms` to call yet.

**The reserved channel.** The bridge defines a device-capability call — `window.__farmBridge.call(name,
method, args)`, surfaced as `native.<name>` — and both the Android and iOS shells carry a `FarmPlugin`
interface for it. But no plugins are registered (`MainActivity.kt` and `SceneDelegate.swift` ship an
empty plugin map), so every such call returns `{ code: "native_unavailable" }`. This is the seam that
device plugins will plug into; it is the right-hand channel in the
[architecture figure](/blog/web-to-native#on-the-device).

**Reaching a real device feature.** For something like reading SMS you drop to native code, where the
platform SDK is in reach:

- A **fully native screen** — `page.kt` (Kotlin + Jetpack Compose) or `page.swift` (Swift + SwiftUI) —
  is where you call `SmsManager`, `CameraX`, or `CLLocationManager` and declare the matching permission
  in the manifest. Farm hands the screen the `farm` object for route params, server calls, and
  navigation; the device API itself is ordinary native code you write. These screens are
  [designed but not built yet](#native-screens): Farm records the route as `platform` and shows a
  placeholder.
- To ship one on a real app now, **eject** the generated project and register a screen in
  `FarmNativeScreens` — the one coded path to arbitrary platform APIs. You own that native code from
  then on.

**Web APIs are not a back door either.** The WebView enables only JavaScript and DOM storage, not
media or geolocation grants, so a web screen cannot quietly use `getUserMedia` or the Geolocation API.

In short: navigation, server data, and auth work across every screen today; device capabilities are
**designed, not shipped** — the reserved `native.<name>` channel and the native-screen escape hatch,
both on the roadmap.

## Auth on mobile

Web screens sign in exactly as they do in a browser: the session cookie lives in the WebView's
cookie store. Native screens send no cookies, so after a sign-in on a web screen the shell trades
that cookie session for a **device token**, and `serverFetch` sends it as `Authorization: Bearer`.
On the server, a request with a valid token runs as the same cookie session, so `auth.user()`,
`auth.session()`, an integration's `protectedRoutes`, API routes, and server functions all see the
signed-in user. Nothing to configure: an app with a `mobile` block and a covered auth integration
gets it.

```tsx
// src/app/notes/page.native.tsx: a protected API route, called from a native screen
const response = await serverFetch("/api/notes"); // 401 only if the user is signed out
```

With `@farm.js/auth`, native screens import `getSession`, `useAuth` and `signOut` from
`@farm.js/auth/client`, the same as web pages. Metro resolves the package's `react-native` build,
which calls the same auth routes through `serverFetch`; web bundles do not change.

```tsx
// src/app/account/page.native.tsx
import { Button, Text, View } from "react-native";
import { useAuth } from "@farm.js/auth/client";

export default function Account() {
  const { user, isPending, signOut } = useAuth();
  if (isPending) return <Text>Loading</Text>;
  if (!user) return <Text>Signed out</Text>;
  return (
    <View>
      <Text>{user.email}</Text>
      <Button title="Sign out" onPress={() => void signOut()} />
    </View>
  );
}
```

`getSession()` and `useAuth()` return what the web client returns: signed out (no device token,
or one the server refuses) is `{ data: null, error: null }` and `user: null`. `signIn` and `signUp`
reject on native screens for now: sign in on a web screen, and the device token signs native
screens in.

### How the token is issued

1. The user signs in on a web screen. After the page loads or renders, the shell's native code
   (never the WebView) reads the WebView's cookies for the server.
2. It asks `POST /__farm/mobile/session/challenge` for a one-time nonce, sending those cookies. The
   server answers only if the cookies sign someone in.
3. It sends the nonce to `POST /__farm/mobile/session` with the same cookies, and gets an access
   token (15 minutes) and a refresh token (30 days). The response also sets a `farm_mobile`
   cookie in the WebView that names the device.
4. The shell stores the tokens: Android encrypts them with an AES-GCM key in the Android Keystore
   (only ciphertext is in SharedPreferences); iOS keeps them in the Keychain, readable only on this
   device after first unlock. React Native screens get the access token through the shell; the
   refresh token never reaches JS.
5. On a `401`, `serverFetch` asks the shell to refresh once (`POST /__farm/mobile/session/refresh`)
   and retries the call if its body can be sent twice. Refreshes are serialized in the shell.

Every endpoint takes `POST` only, needs an `X-Farm-Mobile: <mobile.id>` header, and refuses any
request with an `Origin` or `Sec-Fetch-*` header: browsers send those on every `POST` and every
`fetch`, so no web page, the app's own included, can mint, refresh, or use a token. Everything is
sent in headers.

### On the server

- Tokens are opaque: a device id, a random secret, and a key. Farm storage
  (`getStorage("farm-mobile")`) keeps a SHA-256 of each secret, never the secret, and the
  device's cookies encrypted with AES-GCM under the key, which exists only inside the tokens.
  Mount persistent storage there for production (`storage.mounts`); with the default in-memory
  storage, tokens end when the server restarts and are not shared between instances.
- A request with a valid access token, the `X-Farm-Mobile` id it was issued to, and no browser
  headers runs with the device's cookies in place of its own, without the token, and with `Origin`
  set to its own origin. Server functions, server actions, and integration routes accept it. Its
  response is `Cache-Control: private, no-store`, and cookie changes in it are kept in the device's
  copy instead of being sent to the phone.
- A bearer on a request with browser headers is ignored: the request keeps today's cookie and
  origin checks, so browser CSRF protection is unchanged.
- Refresh rotates both tokens. A refresh token that comes back after it was rotated revokes the
  device, both tokens.
- Each refresh checks that the cookies behind the device still sign in the same session. A session
  that ended or was replaced ends the device.

### Signing out

- **On a web screen:** a sign-out response from the shell's WebView that leaves no session
  revokes the device on the server and clears the `farm_mobile` cookie; the shell sees it gone
  and deletes its tokens. A sign-out called from a native screen through `serverFetch` revokes the
  device the same way.
- **From a native screen:** `signOut()` from `@farm.js/auth/client` ends the server session
  (`POST /api/auth/sign-out` through `serverFetch`), then forgets the device: it revokes the device
  token (`POST /__farm/mobile/session/revoke`), deletes it from the Keystore or Keychain, and
  clears the server's cookies in the WebView. The device step runs even when the server call fails
  or the phone is offline, and the server's error is still returned or thrown.
- `signOut()` from `@farm.js/native` is the low-level "forget this device" step on its own. It
  does not end the server session; with another auth, such as `@farm.js/better-auth`, call its
  sign-out route with `serverFetch` first.
- A refresh the server refuses also deletes the tokens on the device.

### Covered auth integrations

The server reads sessions through an integration's `session(request)`: who the request's cookies
sign in, as `{ id, userId?, expiresAt? }`, or `null`.

| Integration                      | Mobile tokens                                                      |
| -------------------------------- | ------------------------------------------------------------------ |
| `@farm.js/auth` (`auth: true`)   | Covered                                                            |
| `@farm.js/better-auth`           | Covered, through the instance's `api.getSession`                   |
| Auth0, Auth.js, WorkOS, Supabase | Not yet: they need a `session()` reader (follow-up)                |
| Clerk                            | Not yet: its session cookie is refreshed by Clerk's browser script |
| A custom integration             | Add `session(request)` to it                                       |

Without an integration that reads sessions, the endpoints answer `501` and native screens stay
signed out.

In `farm dev`, `@farm.js/auth` trusts the origin the dev server is serving, so web sign-in works
from the Android emulator's `http://10.0.2.2:<port>` and from a device on the LAN under `--host`
without setting `FARM_AUTH_URL`.

### What this protects against, and what it does not

- **Protects against:** a web page, cross-site or the app's own, minting, refreshing, reading, or
  using a token; a forged or guessed token; a token used with another app id; an expired or revoked
  token; a replayed refresh token; a token outliving a web sign-out or the session it came from;
  a storage dump yielding tokens or session cookies.
- **Does not prove** that a request comes from the app's own binary. Any non-browser client that
  already holds the user's session cookie can mint a token with any app id. That gives it nothing
  the cookie did not, since the token lives only as long as that cookie session. Platform
  attestation (App Attest on iOS, Play Integrity on Android) signing the challenge nonce is the
  follow-up that proves the binary.
- Single use of nonces and refresh tokens is best effort across server instances: Farm storage has
  no atomic compare-and-set.
- The `farm_mobile` cookie names its device. Something that can set that cookie in the WebView,
  with a signed-out session, can revoke that device.

### Limits

- Server components apps in islands mode run Farm's own server and get device tokens like any
  app. Apps on the RSC pipeline (`experimental.serverComponents: true` or `{ mode: "rsc" }`)
  cannot use `auth` or `integrations` yet (the pipeline refuses to start with them), so there is
  no session to trade: their native screens stay signed out, and a bearer never gets past their
  middleware.
- The device keeps the cookies it had when the token was issued, plus the rotations its own
  requests receive. A cookie rotated only in the WebView is not copied; the device keeps working
  while its own cookies sign in the same session.
- Not yet run on a physical device, and the iOS shell has not been built with Xcode.

## The native-screen report

Auto-porting a page to a native screen is driven by a **build-time static-analysis pass**, the
analyzer. It parses each page's source into an **abstract syntax tree** (AST) with
[Oxc](https://oxc.rs), walks that tree, and classifies every JSX element, class name, inline style,
browser API, and import against a portability model. From the parts it can map, it builds a
**platform-neutral UI tree** (an intermediate representation, or IR) that a native emitter turns into
a React Native, Compose, or SwiftUI screen.

_The analyzer pipeline — parse each page, classify every node as a **port** (renders native) or a
**block** (stays web), collect the ports into the IR, then conservatively pick the tier — is animated
in the blog post [Your web app, native](/blog/web-to-native#how-the-analyzer-decides)._

With `auto: "on"`, a native-tier route becomes a
[server-rendered native screen](#server-rendered-native-screens), and a `port` route on Android
becomes a [generated React Native port](#generated-react-native-ports) of its page.

```sh
farm config inspect --mobile --report   # table, plus .farm/output/mobile/native-report.json
```

```text
route        screen  tier          decision  mapped  portable  reason
/feed        native  -             -                           src/app/feed/page.native.tsx
/notes       web     react-native  port      12/12   100%      portable; input, list
/notes/[id]  web     web           web       9/10    90%       src/app/notes/[id]/page.tsx:41:9 dangerouslySetInnerHTML
/settings    web     native        web       18/18   100%      renders natively, no JavaScript on the device
```

### Tiers

Each analyzed route gets a **tier**, the first one nothing rules out:

| Tier           | What it means                                                                                                                                                      | Ruled out by                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `native`       | The server renders the page into native views, with no JavaScript on the device. Async pages and server data are fine: they run on the server, as for the web page | hooks, event handlers, `"use client"` modules, package components, and the blockers below      |
| `react-native` | A React Native screen ported from the page can run its logic on the device                                                                                         | the blockers below, async pages, server components, Node.js APIs, and packages not on the list |
| `web`          | A WebView of the page                                                                                                                                              | —                                                                                              |

The native tier looks only at the page and its app modules: the native shell draws the chrome, so
layouts are not part of a native screen. The report keeps the two lists apart, `nativeBlockers` for
the native tier and `blockers` for a React Native port, and the table shows the first blocker of the
tier to aim for.

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
With `auto: "on"`, a native-tier route is recorded in `farm-routes.json` as a `server` screen
with `source: "analyzer"`, and a `port` route as a `native` screen whose file is its generated port.
A port the emitter cannot write stays web with `requested: "native"` and a warning. Facts are cached
by file content
in `.farm/cache/mobile/` and keyed by the analyzer and Farm version, so the report is cheap to
re-run.

### Generated React Native ports

For a `port` route, Farm writes a React Native screen from the page itself into
`.farm/output/mobile/ports/`, and registers it like a hand-written `page.native.tsx`. The copy is
the page as written, with each DOM element renamed to `@farm.js/native/elements`:

```tsx
// .farm/output/mobile/ports/src/app/lab/packing/page.tsx (generated)
<__FarmDom.input value={draft} onChange={(event) => setDraft(event.target.value)} />
<__FarmDom.button onClick={() => setItems([...items, draft])}>Add</__FarmDom.button>
```

- **The page's logic runs unchanged.** Hooks, state, and handlers are the page's own code; the
  elements adapt DOM props and events (`onClick`, `onChange` with `event.target.value`), wrap bare
  text in `Text`, and pass inherited text styles down as CSS does. `Link` navigates through the
  shell. App components the page imports are copied the same way; other modules are imported where
  they are.
- **Styles are the web page's.** Elements start from the browser's default styles, then the app's
  CSS, then their inline `style`. A production build links all of an app's CSS on every page, so
  the emitter reads every plain `.css` file the app imports and resolves, per element type, the
  rules that match the type alone (`h1`, `input`, `*`, `:root`, `body`), light and dark. `body`
  gives the screen its background, text style, and margin. A rule that also depends on where the
  element renders (`main h1`, `li + li`, attributes, `:first-child`) keeps the route web, unless it
  needs a class nothing around the page renders.
- **Anything it cannot emit keeps the route web**, with the reason in the warning: `className`
  (ports do not load Tailwind classes yet), `useContext`, `@farm.js/ui`, server functions,
  `@farm.js/core` APIs other than `Link`, packages outside the pure list, asset imports, dynamic
  `import()`, and stylesheets with `@import`, `@layer`, or Tailwind directives, or that are not plain
  CSS.

Not yet: ports in `farm dev --mobile` (the analyzer runs in builds, so they show as web screens in
dev), iOS, `FlatList` for long lists, event bubbling from a child to a parent's `onClick`, and a
live light/dark switch (a screen takes the theme it opened with). The browser's default styles are
Chrome's, approximated.

## Route manifest

The navigator manifest, `farm-routes.json`, has one rule per page route in the client router's
order, with the base path and optional locale prefixes in each pattern, and each rule's `screen`,
`source`, and `module`. A web build never calls or checks the block and strips it like `desktop`.

## Platform detection

`platform()` from `@farm.js/core/platform` returns `"mobile"` only in the mobile client, which pages
load inside a shell. They render on the web deployment, whose server reports `"web"`, so don't
branch render output on it (the page would not hydrate to the same markup); branch in effects and
event handlers. See [Platform and app data](/docs/desktop#platform-and-app-data) for how `platform()` folds to
a literal at build time.

## Run on Android

Install the shell package and the Android toolchain from [Requirements](#requirements):

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

`farm build --mobile` makes the same production build as `farm build`, web client and mobile client,
into `.farm/output/mobile/www` (the web build's output is left alone), writes `farm-routes.json`
with `mobile.server`, prints the native screen report above unless `native.auto` is `"off"`, and
generates the project with the mobile client's files in it. `--apk` builds the debug APK into
`.farm/output/mobile/dist`. The project is regenerated on every run, so don't edit it.

| Path                                     | Contents                                               |
| ---------------------------------------- | ------------------------------------------------------ |
| `app/src/main/assets/farm-routes.json`   | The navigator manifest                                 |
| `app/src/main/assets/farm-bridge.js`     | Bridge script injected into pages on the server origin |
| `app/src/main/assets/farm-www/`          | The mobile client's files (`farm build --mobile`)      |
| `app/src/main/assets/farm-assets.json`   | Those files' paths and content types                   |
| `app/src/main/assets/farm-shells/`       | Page shells (`mobile.shells`), one file per shell      |
| `app/src/main/java/.../Navigator.kt`     | Tabs, stacks, push, modal, replace, predictive back    |
| `app/src/main/java/.../WebViewPool.kt`   | Two pre-warmed WebViews that back pushes               |
| `app/src/main/java/.../NativeScreens.kt` | The hook for `native` and `platform` screens           |
| `app/src/main/java/.../NativeEngine.kt`  | React Native for native screens (none without them)    |
| `app/src/main/assets/farm-native.hbc`    | The native screens' Hermes bytecode (`farm build`)     |

The shell marks each page with `data-farm-shell="android"` on `<html>` before it renders, so app
CSS can hide chrome the shell already draws, such as web tabs:

```css
html[data-farm-shell] .web-tabs {
  display: none;
}
```

Cleartext (`http://`) is allowed only under `farm dev --mobile`, for the dev server and the
emulator loopback; builds are `https://` only.

## Run on iOS

`--os ios` generates the iOS shell as an Xcode project. **It has not been built with `xcodebuild`
yet**: its Swift was type-checked against the Mac Catalyst SDK and run as a Mac Catalyst app, not in
an iOS simulator.

Building it requires a Mac with Xcode, the iOS 16 or newer SDK, and an iOS simulator runtime; the
Command Line Tools alone are not enough. Tested with: no Xcode version yet. The app targets iOS 16.

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -runFirstLaunch
xcodebuild -downloadPlatform iOS        # the simulator runtime, once
open -a Simulator                       # boot a simulator

farm dev --mobile --os ios              # dev server, Xcode project, build and open on the simulator
farm build --mobile --os ios            # mobile client build and Xcode project
```

`farm dev --mobile --os ios` points `farm-routes.json` at `http://localhost:<port>` (a simulator
shares the Mac's network), generates the Xcode project into `.farm/output/mobile/ios`, and, when
`xcrun simctl` lists a booted iOS simulator, builds it with `xcodebuild`, installs it, and opens it.
Without Xcode or a booted simulator it prints what to install and the commands to run.

Farm builds and installs simulator apps only. A physical iPhone needs code signing: open
`App.xcodeproj` in Xcode, set a signing team, and run it from there. `--host 192.168.1.20` points
the app at a LAN address the phone can reach, but Farm does not sign or install the app for you.

`farm build --mobile --os ios` writes the project with `mobile.server` and, when Xcode is
installed, also builds the debug simulator app into `.farm/output/mobile/dist`. `--apk` is
Android only. Archives for the App Store need the same signing team. The project is regenerated on
every run, so don't edit it.

| Path                                    | Contents                                                        |
| --------------------------------------- | --------------------------------------------------------------- |
| `App.xcodeproj`                         | One iOS app target, `App`, with the bundle ID `mobile.id`       |
| `App/farm-routes.json`                  | The navigator manifest                                          |
| `App/farm-bridge.js`                    | The same bridge script as Android, with the iOS message handler |
| `App/farm-shells/`                      | Page shells (`mobile.shells`), with their stylesheets inlined   |
| `App/Navigator.swift`                   | A tab bar with a navigation stack per tab, push, sheet, replace |
| `App/WebViewPool.swift`                 | Two pre-warmed WKWebViews that back pushes                      |
| `App/FarmBridge.swift`                  | The message handler and the document-start script               |
| `App/FarmBuild.swift`                   | Build constants: dev or build, the start path, the tab symbols  |
| `App/NativeScreens.swift`               | The hook for `native` and `platform` screens                    |
| `App/Info.plist`, `App/Assets.xcassets` | Display name, version 1.0, a placeholder icon, the shell colors |

The iOS shell matches the Android one: tabs come from `mobile.tabs` with SF Symbol icons (`notes`,
`settings`, `gear`, `home`, `search`, and `person` map to symbols; other names are used as symbol
names), back is the system swipe, modals are page sheets, links to other origins open in
`SFSafariViewController`, the bar shows `document.title`, and a WebView whose web content process
ends reloads instead of going blank. Pages get `data-farm-shell="ios"`.

The bridge is a `WKScriptMessageHandler` that drops any message not sent by the main frame of the
server's origin, and its script is a document-start `WKUserScript` that runs only on that origin.
The `-FarmServer <url>` and `-FarmPool <n>` launch arguments
(`xcrun simctl launch booted <id> -FarmServer http://localhost:3001`) and plain-HTTP App Transport
Security exceptions (local networking and the dev host) exist only in projects generated by
`farm dev --mobile`; `farm build --mobile` apps load `mobile.server` over HTTPS only.

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
- **Runtime (the web twin).** A native screen that cannot load or render falls back to its web
  page: a React Native runtime that fails to start, a missing or broken bundle, or a screen that
  throws shows the route's `page.tsx` in a WebView, and an unbuildable native request resolves to
  web at build time. In dev, React Native's error screen shows a screen that throws while loading
  instead.

### Why this shape, and not the alternatives

These were weighed and set aside (the full rationale lives in the platforms RFC,
[RFC 0004](https://github.com/farming-labs/farm.js/pull/2352)):

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
(Chromium on Android, WebKit on iOS). The `native` tier runs on **React Native's own
engine** — Hermes, under its new architecture — not a Farm runtime; the `platform` tier runs
**no JS engine at all** (Compose / SwiftUI). So an app ships a JS engine on device only if it opts a
route into the React Native tier.

## What is landing

The config surface, the route manifest, the WebView shell, and the report all work today. These
parts are designed and still on the way:

- The iOS shell has not been built with `xcodebuild` or run in a simulator yet (see
  [Run on iOS](#run-on-ios)), and it has no Keychain session.
- React Native screens run on Android only; there is no iOS React Native host yet, so
  `page.ios.tsx` is not built and `native` screens show a placeholder on iOS.
- React Native screens are verified under `farm dev --mobile` on an Android emulator only, not in a
  production (Hermes bytecode) build or on real devices.
- `platform` screens show a placeholder naming the module id. Farm does not build `page.kt` or
  `page.swift` yet; `FarmNativeScreens` in the generated project is where they will register.
- React Native screens use React Native's own components. `@farm.js/ui` components, native modules
  from `src/native/`, `layout.native.tsx` providers, intent prefetch, and server functions called by
  reference are not wired into native screens yet; `serverFetch` calls API routes. Images imported
  by native screens are not copied into the app yet; load them by URL.
- Page shells are tested in unit and generator tests, and the iOS code type-checks; they have not
  run in a production build on an Android emulator or an iOS simulator yet (see
  [Page shells](#page-shells)). iOS loads the mobile client from the server rather than the app,
  and prerendered pages load the web client (see [Bundled client assets](#bundled-client-assets)).
- A generated port of `examples/mobile`'s `/lab/packing` ran on an Android emulator from Metro's
  dev bundle, with the analyzer switched on for the test (`farm dev --mobile` does not run it), and
  ports bundle with Metro and Hermes for a production build. They have not run from a production
  APK or on a device, and iOS keeps their routes web. See
  [Generated React Native ports](#generated-react-native-ports) for what they cannot emit yet.
- Native islands (`mobile.native.islands`), native rendering of `@farm.js/ui` (it renders on the
  web only), and the theme-token pipeline are reserved.
- Signed-in native screens are tested in unit, dev-server and production-build tests, and the
  Android shell's session code on an emulator under `farm dev --mobile`. The Swift session code
  has not been built with Xcode (it type-checks against the macOS SDK). See
  [Auth on mobile](#auth-on-mobile) for which auth integrations are covered.
- Device plugins (`native.<name>`) ship none, so calls reject as unavailable.
- Apps on the RSC pipeline get no device tokens until it runs `auth` and integrations (see
  [Auth on mobile](#auth-on-mobile)), and their pages always load as documents in the WebView pool.
