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
today is the WebView shell on Android.** The iOS shell builds and launches on an iOS simulator in CI (see [Run on iOS](#run-on-ios)). React Native screens (not released
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

| Part                                          | Status                         | Notes                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android shell with web screens                | **Preview, shipped in 0.1.50** | Tabs, stacks, modals, predictive back, the WebView pool, and the bridge                                                                                                                                                                                                                        |
| `mobile` config, screen files, route manifest | **Shipped in 0.1.50**          | `native` and `platform` routes are recorded in `farm-routes.json` and show a placeholder                                                                                                                                                                                                       |
| Native-screen analyzer                        | Unreleased                     | Sorts routes into tiers; proven native-tier routes become `server` screens with `native: true` or `auto: "on"`                                                                                                                                                                                 |
| Generated React Native ports                  | Unreleased                     | Android: emitted from portable pages with `auto: "on"`; run on an emulator, not yet on a device. See [Generated ports](/docs/mobile/native-screens#generated-react-native-ports)                                                                                                               |
| Server-rendered native screens (`server`)     | Unreleased                     | Android: drawn with Android views, run on an emulator under `farm dev --mobile`, not yet on a device. iOS: drawn with UIKit, type-checked (Swift 5 and 6); simulator smoke requires native home content                                                                                        |
| iOS shell                                     | Unreleased                     | Builds with Xcode 16.4 and launches on an iOS simulator in CI (see [Run on iOS](#run-on-ios))                                                                                                                                                                                                  |
| React Native screens                          |                                | Unreleased                                                                                                                                                                                                                                                                                     | Android: on an emulator under `farm dev --mobile` and as a production APK. iOS: renders from a production build on a simulator in CI (see [React Native screens on iOS](#react-native-screens-on-ios)). Not yet on a device |
| Bundled client assets                         | Unreleased                     | Pages in a production shell run the mobile client; Android serves its files from the APK, iOS from the server (see [Bundled client assets](/docs/mobile/shell#bundled-client-assets))                                                                                                          |
| Page shells                                   | Unreleased                     | `mobile.shells`: a route's layout and loading state, shown before its document and while offline; not yet run on an emulator or simulator (see [Page shells](/docs/mobile/shell#page-shells))                                                                                                  |
| Signed-in native screens (device tokens)      | Unreleased                     | Android shell run on an emulator under `farm dev --mobile`; native sign-in not yet run on an emulator; iOS auth flows not yet exercised in the simulator (see [Auth on mobile](#auth-on-mobile))                                                                                               |
| Server components apps                        | Unreleased                     | Both engines get the mobile client; islands mode also gets device tokens, the RSC pipeline does not (see [Bundled client assets](/docs/mobile/shell#bundled-client-assets)); no page shells yet                                                                                                |
| Platform screens (`page.kt`, `page.swift`)    | Planned                        | Show a placeholder                                                                                                                                                                                                                                                                             |
| Native `@farm.js/ui`                          | Unreleased, Android            | React Native views on native screens and generated ports; tokens resolve to the web defaults; run in tests, not yet on a device (see [Portable components](#portable-components-farmjsui))                                                                                                     |
| Native-only routes                            | Unreleased                     | `page.native.tsx` with no `page.tsx`: the route exists only in the app, on both OSes, and the web deployment answers it as not found; the shells' error fallback does not read `nativeOnly` yet                                                                                                |
| Native islands                                | Planned                        | `mobile.native.islands` is reserved                                                                                                                                                                                                                                                            |
| App native modules and `mobile.modules`       |                                | Unreleased                                                                                                                                                                                                                                                                                     | TurboModules from `src/native/` on React Native screens: Kotlin on Android, Objective-C++ on iOS (see [App native modules](/docs/mobile/modules#app-native-modules))                                                        |
| Device modules for web screens                | Unreleased                     | App modules with `mobile.modules.<name>.web` answer `native.<name>` calls from web screens, on Android and iOS; large results as [file references](/docs/mobile/modules#files-by-reference) on Android (see [Web screens call app modules](/docs/mobile/modules#web-screens-call-app-modules)) |

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

| Option    | Notes                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `name`    | Defaults to package.json `productName` or `name`                                                                     |
| `id`      | Android application ID and iOS bundle ID: letters and digits per segment, such as `com.a.notes`                      |
| `server`  | Origin of the web deployment. `https://`; `http://` only for loopback and LAN hosts in dev                           |
| `tabs`    | At most 5. Each `path` is a static page route                                                                        |
| `routes`  | Keyed by page route pattern: `presentation` (`push`, `modal`, `replace`)                                             |
| `native`  | Screen tiers per route, the native engine, and the analyzer (below)                                                  |
| `shells`  | `true` bundles [page shells](/docs/mobile/shell#page-shells) in `farm build --mobile`. Defaults to `false`           |
| `modules` | Android permissions and iOS usage strings per native module ([`mobile.modules`](/docs/mobile/modules#mobilemodules)) |

Tabs and route keys are checked against the app. A web build never calls or checks the block and
strips it from the server, as it does `desktop`. It also builds the
[mobile client](/docs/mobile/shell#bundled-client-assets): the web client's files stay byte-identical to the same
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

| You want…                                                  | Add this                              |
| ---------------------------------------------------------- | ------------------------------------- |
| the normal case: one page for web and mobile               | just `page.tsx`                       |
| a native-feeling screen, written in React                  | `page.native.tsx`                     |
| that native screen, but different per platform             | `page.ios.tsx` / `page.android.tsx`   |
| a fully native screen (platform APIs, maximum performance) | `page.kt` / `page.swift`              |
| an app-only screen, with no web version at all             | `page.native.tsx` alone (native-only) |

Whatever you add, `page.tsx` usually stays: it is the web version of the route and the fallback if
the native screen cannot load (the "web twin"). The one exception is a **native-only route**
([RFC 0004](https://github.com/farming-labs/farm.js/blob/main/rfcs/0004-platforms.md)): a
`page.native.tsx` with no `page.tsx` next to it, for a screen that has no web audience. The route
then exists only in mobile builds, on both OSes — it is not in the web route types, not in any web
bundle, and the web deployment answers it like any unknown path — and it has no web twin, so the
screen owns its errors. An OS file (`page.ios.tsx`) or a platform file alone still needs a
`page.tsx`, since the route would be missing on the other OS.

> **Heads up:** most of the native screens above are designed but **not built yet**.
> `page.native.tsx` runs as a React Native screen on an Android emulator and an iOS simulator;
> `page.kt` and `page.swift` routes show a placeholder (see [Native screens](#native-screens) for the exact status). Web screens
> (`page.tsx`) are what runs now; the other examples show what each file will look like.

## Portable components (`@farm.js/ui`)

`@farm.js/ui` gives you a small set of primitives — `View`, `Text`, `Image`, `Pressable`,
`TextInput`, `List`, and `PhotoPicker` — that render as **DOM on the web** and, on a mobile **native** screen, as
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
[analyzer](/docs/mobile/native-screens#the-native-screen-report) recognize a page built from `@farm.js/ui` as one it can port to
a native screen automatically. Raw values still pass through (`padding={10}`, `background="#fff"`),
and every box-like primitive takes a `style` escape hatch.

**Status:** web rendering ships; native rendering is unreleased. On a React Native screen, Metro
resolves `@farm.js/ui` to its React Native build (the `react-native` export condition, implemented
in `@farm.js/native/ui`): `View`, `Text` (with real `numberOfLines`), `Image` (paths load from
`mobile.server`; without a size it takes the image's natural size, and given one side it keeps the
aspect ratio, as an `img` does), `Pressable` (an `href` navigates through the shell), `TextInput`
(`onChange` still gets the string), and `List` as a recycling `FlatList`. `Text as="h1"` to `h6`,
and `View`'s `as` (`nav`, `main`, `section`, ...) or `role`, set the native `role`, so screen
readers announce the same headings and landmarks; `align` and `justify` accept CSS's `start` and
`end` there too. Tokens resolve to the same values as
the web build's defaults (`padding="md"` is 12, `surface` is `#f6f6f6`); a CSS theme's
`--farm-color-*` overrides and `className` do not reach native views yet. A `page.tsx` built from
`@farm.js/ui` [ports](/docs/mobile/native-screens#generated-react-native-ports) as it is, since Metro gives it the native
components. Prefer `@farm.js/ui` over importing `react-native` directly: the raw React
Native primitives are the lower-level escape hatch, used inside a hand-written
[`page.native.tsx`](#the-files-that-make-a-screen) when you need something the portable set does not
cover.

`PhotoPicker` is an unstyled control (the same token props as `Pressable`) that hands `onPick` a
photo URL `Image` can show. On the web it is a label around an `accept="image/*"` file input and
gives an object URL, revoked on the next pick and on unmount. Given `pick`, an app module's method
that resolves a photo's URL or null, it calls that instead: on a web screen in the Android app
`native.Device.pickPhoto` returns a [file reference](/docs/mobile/modules#files-by-reference), and
on a native screen `Device.pickPhoto` returns a `file://` URI. Without `pick` the native build is
disabled, since React Native has no file input.

```tsx
// The server render has no shell, so check for the module after hydration.
const [inApp, setInApp] = useState(false);
useEffect(() => setInApp(native.Device.available()), []);

<PhotoPicker
  pick={inApp ? native.Device.pickPhoto : undefined}
  onPick={setPhoto}
  padding="sm"
  radius="md"
>
  Choose a photo
</PhotoPicker>;
{
  photo ? <Image src={photo} alt="Your photo" radius="card" /> : null;
}
```

## How a web screen renders

The default screen is your page in a WebView, run by a native navigator over a warmed
WebView pool, with an origin-scoped bridge, bundled client assets, and page shells for
instant, offline-safe opens. The internals live in [The web shell](/docs/mobile/shell).

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
the tier. A `page.native.tsx` with no `page.tsx` makes the route
[native-only](#the-files-that-make-a-screen); any other native file without a `page.tsx` is an
error, and so is a React Native
file and a platform file for the same route and OS. Web and desktop builds never resolve these
files: they are not routes, not in the generated route types, and not in any web bundle.
`src/native/` holds the app's own native modules ([App native modules](/docs/mobile/modules#app-native-modules)).

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
tier ([tiers](/docs/mobile/native-screens#tiers)). Otherwise `farm dev --mobile` and `farm build --mobile` fail and name every
blocker:

```text
mobile (os: android): src/app/page.tsx sets mobile.native to true, but "/" cannot render as a native screen:
  - src/app/page.tsx:4:19 useState() runs on the device
It needs JavaScript on the device: add page.native.tsx next to the page, or remove mobile.native.
```

The check runs on every dev start and build, whatever `native.auto` is. A passing route becomes a
`server` screen ([Server-rendered native screens](/docs/mobile/native-screens#server-rendered-native-screens)).

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

## Native screens

Three tiers make a route more native than a WebView: `server` screens drawn from the page
the server renders (Android views, UIKit on iOS), React Native screens from
`page.native.tsx`, and planned `page.kt` / `page.swift` platform screens — plus the
analyzer report that decides who gets which. All of it lives in
[Native screens](/docs/mobile/native-screens).

## Native device features

Device APIs are React Native modules: community modules and the app's own TurboModules in
`src/native/`, declared in `mobile.modules`, with an opt-in channel that lets web screens
call them as `native.<name>` after an `available()` check. The whole model lives in
[Native device features](/docs/mobile/modules).

## Auth on mobile

Sign-in happens once on a web screen; the shell then trades the cookie session for device
tokens (Keychain / Keystore), which native screens and server-function calls send as
bearer tokens. The flow, covered integrations, and limits live in
[Auth on mobile](/docs/mobile/auth).

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

`--os ios` generates the iOS shell as an Xcode project. The Mobile iOS CI workflow builds the
production project, then builds and launches the dev shell on an iOS simulator. It retains
screenshots and app logs, and requires proof that the native home screen drew its content. Swift
also type-checks against the Mac Catalyst SDK in Swift 5 and 6 modes.

Building it requires a Mac with Xcode, the iOS 16 or newer SDK, and an iOS simulator runtime; the
Command Line Tools alone are not enough. CI has built the shell with Xcode 16.4. The app targets iOS 16.

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

### React Native screens on iOS

When a route resolves to a React Native screen on iOS (`page.native.tsx`, `page.ios.tsx`, or a
generated port), the project also hosts React Native, the same way the Android shell does: one
shared Hermes runtime (Fabric, bridgeless), started when the first tab shows content, and each
React Native screen a surface in the navigator's own screen, so push, swipe back, sheets and tabs
work as for web screens. A screen that fails shows its web twin; a native-only route shows why it
could not open.

React Native comes from its prebuilt XCFrameworks on Maven Central, not CocoaPods. The first
`xcodebuild` downloads the three for the app's `react-native` and Hermes versions (React, its
third-party dependencies, and Hermes; release artifacts for `farm build`, debug for `farm dev`),
checks them against the published SHA-256, and caches them in `~/Library/Caches/farm.js/react-native`
(`FARM_REACT_NATIVE_CACHE` overrides it). `ReactNative/` in the project links to that cache.

| Path                                     | Contents                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `FarmReactNativeHost/FarmReactNative.mm` | The host: the factory, surfaces, the `FarmShell` module, fatal handlers   |
| `App/FarmReactNative.h`                  | Its plain Objective-C protocols, the only part Swift sees                 |
| `App/NativeEngine.swift`                 | The engine the navigator opens native screens with                        |
| `App/farm-native.hbc`                    | The screens as Hermes bytecode (`farm build` only; `farm dev` uses Metro) |
| `FarmModules/`                           | Linked native modules and their Codegen output, when the app has any      |
| `ReactNative/`                           | A link to the cached XCFrameworks                                         |

React Native loads lazily. The host and the linked modules build into a `FarmReactNativeHost`
framework that links React Native; the app embeds it and React Native's frameworks without
linking any of them, so launching the app loads none of React Native. The engine loads the
framework in the background once the first tab shows content, or at once when a native screen or
a web screen's module call comes first, which then waits for it (65 to 90 ms on the simulator).
If it cannot load, native screens show their web twin.

Installed React Native modules are linked from the app's `dependencies`: each package's podspec
`source_files` are compiled into the app and React Native's Codegen writes their glue. The app's
own TurboModules on iOS are Objective-C++ classes in `src/native/` that adopt their spec's
`Native<Name>Spec` protocol, such as `DeviceModule.mm` in `examples/mobile`.

Swift sources compile into the host framework too, as one module, so a package's Swift can
`import React` and its Objective-C reaches the Swift through `<Module>-Swift.h`, the header
CocoaPods would generate, which Farm forwards to the framework's
`<FarmReactNativeHost/FarmReactNativeHost-Swift.h>`; the app's own Objective-C++ in `src/native/`
imports that directly. Because every package's Swift shares the module, two packages that declare
the same Swift type name do not build together, and a package's Swift sees its own Objective-C
only through what React exports.
`examples/mobile/modules/farm-swift-sample` is a module laid out as community Swift modules are,
and `/map` calls it on the simulator in CI.

An app without React Native routes on iOS gets no React Native: no download, no framework, and the
same project as before.

What React Native costs on a phone, measured on the Release configuration archived for a device
(arm64, unsigned) in the `Mobile iOS` workflow:

| Release app for a device                  | `examples/mobile` (React Native, 4 screens) | `examples/mobile-minimal` (no React Native) |
| ----------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Installed                                 | 20.7 MB                                     | 0.4 MB                                      |
| Download (the app zipped as an IPA)       | 5.8 MB                                      | 0.1 MB                                      |
| Download, executable counted uncompressed | 6.1 MB                                      | 0.4 MB                                      |
| React Native's frameworks                 | 18.7 MB: React 11.4, Hermes 6.1, deps 1.2   | none                                        |
| Screens as Hermes bytecode                | 1.4 MB                                      | none                                        |

The App Store encrypts the executable, which then no longer compresses, so the third row is the
closer download estimate. The App Store's own figure for a signed build may differ.

`xcrun simctl launch booted <id> -FarmOpen /kit` opens a path once the first screen shows content,
in any build, as a tapped link would; `-FarmOpenAfter 3000` waits that many milliseconds longer.

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

- The iOS shell builds and launches in simulator CI (see [Run on iOS](#run-on-ios)). Physical
  devices and end-to-end Keychain sign-in, refresh and sign-out flows remain unverified.
- React Native screens on iOS render in simulator CI from a production build (Hermes bytecode):
  `examples/mobile`'s `/kit` and `/map`, with netinfo and the app's `Device` module. Not yet on a
  device (see [React Native screens on iOS](#react-native-screens-on-ios)).
- React Native screens are verified under `farm dev --mobile` on an Android emulator only, not in a
  production (Hermes bytecode) build or on real devices.
- `platform` screens show a placeholder naming the module id. Farm does not build `page.kt` or
  `page.swift` yet; `FarmNativeScreens` in the generated project is where they will register.
- React Native screens use React Native's own components or `@farm.js/ui`. `layout.native.tsx`
  providers and intent prefetch are not wired into native screens yet. Images imported by native
  screens are not copied into the app yet; load them by URL.
- Page shells are tested in unit and generator tests, and the iOS code type-checks; they have not
  run in a production build on an Android emulator or an iOS simulator yet (see
  [Page shells](/docs/mobile/shell#page-shells)). iOS loads the mobile client from the server rather than the app,
  and prerendered pages load the web client (see [Bundled client assets](/docs/mobile/shell#bundled-client-assets)).
- A generated port of `examples/mobile`'s `/lab/packing` ran on an Android emulator from Metro's
  dev bundle, with the analyzer switched on for the test (`farm dev --mobile` does not run it), and
  ports bundle with Metro and Hermes for a production build. They have not run from a production
  APK or on a device; iOS builds them too. See
  [Generated React Native ports](/docs/mobile/native-screens#generated-react-native-ports) for what they cannot emit yet.
- Native islands (`mobile.native.islands`) and the theme-token pipeline are reserved.
- Signed-in native screens are tested in unit, dev-server and production-build tests, and the
  Android shell's session code on an emulator under `farm dev --mobile`. The Swift session code
  builds with Xcode in CI, but the simulator smoke does not exercise auth. See
  [Auth on mobile](#auth-on-mobile) for which auth integrations are covered.
- Web screens call app modules with `mobile.modules.<name>.web` on Android and iOS. The Android
  path has not run on an emulator yet; iOS runs it on the simulator under `farm dev`, and an object
  parameter with declared properties is Android only. Results by reference and event subscriptions
  are not built.
- Apps on the RSC pipeline get no device tokens until it runs `auth` and integrations (see
  [Auth on mobile](#auth-on-mobile)), and their pages always load as documents in the WebView pool.
