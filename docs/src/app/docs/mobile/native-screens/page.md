---
title: "Native Screens"
description: "Server-rendered native screens, React Native screens, platform screens, and the analyzer report that decides each route's tier."
section: "Runtime"
---

# Native Screens

Part of [Mobile Apps](/docs/mobile): the tiers past the WebView, and how routes reach them.

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
  components work, since they run on the server as for the web page. iOS applies the cookie
  store's host, domain, path, Secure and expiry rules to each server-screen and image request.
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
  and `@media (prefers-color-scheme: dark)`. Inline `style` attributes read the same variables,
  then their fallback, so `@farm.js/ui` color tokens (`var(--farm-color-muted, #6b7280)`) draw
  natively and follow a dark `:root` value. Shorthands such as `margin: 8px 0 4px` and
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
`<code>`), `Image`, links as pressable boxes, and borders, radii, backgrounds, and
opacity, wrapping rows (`flex-wrap: wrap`), and [forms](#forms-on-server-rendered-screens). Not
yet: percentages other than `100%`, wrapping columns, absolute or sticky positioning, and Sass and
other non-CSS stylesheet sources in the analyzer. iOS draws `server` routes with UIKit (stack views,
attributed labels with tappable links, image views), with the same fallback to the web screen; it
is type-checked, and CI builds and launches the shell with a native home route. The smoke check
requires the native content-ready log marker and rejects a fallback to the web screen.

### Forms on server-rendered screens

A plain HTML form works on a server-rendered screen with no JavaScript on the device, so the same
`page.tsx` posts from a browser and from the app, whichever renderer drew it:

```tsx
<form method="post" action="/api/reports">
  <input type="hidden" name="trail" value={trail.id} />
  <label>
    Report <textarea name="text" required maxLength={280} />
  </label>
  <button>Post report</button>
</form>
```

- **The shell submits as a browser does.** A submit button (or Return in a one-line field) sends the
  form's fields, its hidden inputs, and the button's own `name` and `value`, honoring `action`,
  `method`, `enctype`, and a button's `formaction`, `formmethod`, and `formenctype`. A GET form
  visits the action with the fields as its query; a POST sends
  `application/x-www-form-urlencoded` or `multipart/form-data` with the WebViews' cookies and the
  page's `Origin`. `required` stops an empty field and `maxlength` limits typing; other validation
  is the server's.
- **The server answers as it would the browser.** The POST reaches the page or route with its
  body, through middleware and guards. A redirect (post/redirect/get) back to the same page loads
  it again in place; a redirect elsewhere is a visit, so the navigator picks that route's screen. A
  page rendered for the submission, including a 4xx page with its errors, is drawn in place; a
  5xx or a failed request shows an alert and keeps what was typed. Cookies the answer sets reach
  the WebViews.
- **What keeps the web screen.** Fields other than text (`text`, `email`, `password`, `number`,
  `search`, `tel`, `url`) and `<textarea>`, such as checkboxes, selects, and files; a
  `<button type="button">` or `"reset"`; a field or button outside a form, or tied to one with
  `form="id"`; a form inside a form, `method="dialog"`, or `target="_blank"`; and a function
  `action`, which React renders as a `javascript:` URL. The tree lists these in `unsupported`, and
  the analyzer reports them (`inert-control`, `form-action`, `unmapped-element`). The analyzer
  checks a form's controls within one component: a submit button in a separate component keeps
  the route web, so keep the form's controls with the `<form>`.

`examples/mobile-minimal`'s trail page posts trail reports to `src/app/api/reports/route.ts` this
way, and the Mobile Android workflow types a report on the emulator, taps Post report, and requires
it on the redrawn native screen.

### Refresh and accessibility

- **Pull to refresh** loads the page's tree again over what is shown; a failed refresh keeps it.
  Closing a modal refreshes the server screen under it, as it does a web screen, so a list shows
  the note a modal form just saved.
- **Screen readers get what the browser exposes.** `<h1>`–`<h6>` and `role="heading"` are headings
  (TalkBack and VoiceOver heading navigation); `aria-label` names a link, button, or image; a
  field's wrapping `<label>`, `<label for>`, or `aria-label` names the field; submit buttons are
  buttons. `aria-hidden="true"`, `role="presentation"`, and `alt=""` hide a view from screen
  readers while it is still drawn, as in a browser; an element with the `hidden` attribute is not
  drawn at all. Inline runs inside a text block (a link in a paragraph) are read with their block.

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
layer is shared. See [Design notes](/docs/mobile#design-notes) for why native is opt-in rather than the default.

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
example runs its native screens on 19.2.8 with one React in the dev bundle. That is verified in dev
and in a production APK on an emulator. Web pages and native screens bundle the app's one `react`,
so keep `react` and `react-dom` on a single version.

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

In a bytecode build (`farm build --mobile --apk`, a debug APK) against a local production server,
`/map` opens as React Native with its stations. Not verified yet: real devices, so the emulator
numbers say nothing about smoothness on a phone.

```tsx
// src/lib/api.ts: the app's typed API client, shared by web pages and native screens
import { createApiClients } from "@farm.js/core/api/client";
import { apiRoutes, type APIRouter } from "./api.generated";

export const { api, apiClient } = createApiClients<APIRouter>({ routes: apiRoutes });
```

```tsx
// src/app/map/page.native.tsx
import { useNavigate, useServerQuery } from "@farm.js/native";
import { useState } from "react";
import { FlatList, Pressable, Text } from "react-native";
import { apiClient } from "../../lib/api";

// The same typed call a web page makes: GET /api/stations, typed from the route's handler.
async function listStations() {
  const { data, error } = await apiClient.stations.get();
  if (error) throw error;
  return data;
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

Native screens call the same API routes as the web client, over HTTP to `mobile.server`, with the
same typed client: `@farm.js/core/api/client` has a React Native build (Metro picks it through the
`react-native` export condition) whose `createApiClients` sends requests through `serverFetch`
unless given a `baseURL` or `fetch` of its own. Import the client from `@farm.js/core/api/client`,
not `@farm.js/core/client`, so one `lib/api.ts` serves both. Native screens send no cookies. Once
the user has signed in, on a web screen or a native one, `serverFetch` sends the device's session
token, so protected routes see the same user (see [Auth on mobile](/docs/mobile#auth-on-mobile)).

Images a native screen imports ship with the app, as in a React Native app:

```tsx
// src/app/map/page.native.tsx, next to blaze@2x.png and blaze@3x.png
<Image source={require("./blaze.png")} style={{ width: 24, height: 36 }} />
```

Metro picks the scales the device needs. Under `farm dev --mobile` it serves the files. In a
`farm build --mobile` app they are in the app where React Native looks for them: Android
resources (`res/drawable-<density>/`, named from the image's path) and, on iOS, `assets/` next to
the screens' bytecode. A build ships only the images the screens still import. Images by URL
(`source={{ uri }}`) load over the network as usual. The `Mobile Android` and `Mobile iOS`
workflows open `examples/mobile`'s `/map` in the built app on an emulator and a simulator and
check that its bundled image shows.

Server functions work from native screens as they do in server code: import one and call it.

```tsx
// src/app/camera/page.android.tsx
import { createNote } from "../../features/notes/server"; // createServerFn

await createNote({ title: "Photo note" }); // runs on mobile.server, typed as on the web
```

- **The bundle never holds the server module.** Metro resolves a module that defines server
  functions to a generated stub, `.farm/output/mobile/native/server-fns/<hash>.js`, whose exports
  post `{ id, input }` through `serverFetch` to `POST /api/__farm/native/fn`. An id is a hash of
  the module's path from the app root and the export name, so the app and the server agree without
  sharing a build. A native bundle may import nothing else of `@farm.js/core` than
  `@farm.js/core/api/client`: a server module Farm does not recognize as one (a namespace import
  of `createServerFn`, a wrapper factory around it) imports `@farm.js/core` somewhere, and stops
  the bundle with a message rather than ship server code. Define the functions native screens
  import with `createServerFn` or `createServerQuery` imported by name.
- **The server runs only what native screens import.** Farm follows each native screen's app
  imports (relative, `@/`, tsconfig paths) to the server function modules it reaches; a production
  build bundles exactly those, and an id outside them answers `404`.
- **Same pipeline, same user.** The endpoint is an ordinary API route, so middleware and
  `runtime.before` hooks run first (the mobile session plugin turns a signed-in device's token into
  its session), then the function's own input schema, middleware, handler, and output schema.
  Input and result travel as JSON. A declared error throws a `FarmServerFnError` with its `code`,
  `status`, and `data`; any other failure throws `server_error` and is logged on the server only.
- **Only the app calls it.** The endpoint requires `X-Farm-Mobile` and refuses requests with fetch
  metadata (`Sec-Fetch-*`) or another origin's `Origin`. A browser sends fetch metadata on every
  request, and a cross-site page cannot add the header without a CORS preflight that carries its
  own `Origin`, so no page can call a function with a visitor's cookies. Input with `__proto__`,
  `constructor`, or `prototype` keys is refused, the API route's body size limit applies, and a
  result that is not JSON answers `server_error`.
- **Each imported function is a public endpoint.** Anyone who sends the app's request shape can
  call a function a native screen imports, with any input, as with a server action on the web:
  check the input (its `input` schema) and the caller's rights (its `middleware`) inside it.
  Functions no native screen imports are not reachable through this endpoint.
- Not yet: exports other than server functions from those modules (they are not in the stub), and
  a `redirect()` in a function (it throws a `FarmServerFnError` with `redirect` set; navigate
  yourself). A server module a screen starts importing during `farm dev --mobile` stops the native
  bundle with a message to restart, so server code never reaches the app. The endpoint lives under
  `/api`, so an app that moves its API base path elsewhere does not get it yet.

A screen navigates by URL only, so `farm-routes.json` always decides what
opens next: a link from a native screen can open a web screen, a modal, a tab, or another native
screen, and back returns to it.

- **Build.** `farm build --mobile` writes one entry that registers every native screen under its
  module id, bundles it with Metro, and compiles it to Hermes bytecode with the `hermesc` that
  ships with the app's `react-native`. The bytecode is the only JS a release app runs; no code is
  downloaded.
- **Dev.** `farm dev --mobile` starts Metro next to the dev server (port 8081, or the next free
  one) and the debug app loads the screens from it, with Fast Refresh.
- **Native modules.** A community React Native module in the app's `dependencies`, such as
  `@react-native-community/netinfo`, is linked into the Android app: its Java or Kotlin package is
  registered with React Native, its codegen library is built into `libappmodules.so`, and a
  native screen imports it as in any React Native app. Farm reads only the app's own
  `dependencies`, the packages Metro bundles for the screens; `devDependencies` and dependencies of
  dependencies are never linked, and `@react-native-community/cli` is not needed. A module must
  support the new architecture (a `codegenConfig` in its `package.json`): one without it, such as
  `react-native-device-info` 15.0.2, fails the command with an error that names the package
  instead of being skipped. The app's own modules in `src/native/` link the same way
  ([App native modules](/docs/mobile/modules#app-native-modules)). iOS links the same packages without CocoaPods
  ([React Native screens on iOS](/docs/mobile#react-native-screens-on-ios)). A debug APK with netinfo and an app module, and one with an app module alone,
  build and run on an Android 15 emulator.
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
  - An app that links at least one native module, a community one or its own, builds through
    React Native's Gradle plugin and its toolchain, loaded from the app's `node_modules`: Android
    Gradle plugin 9.2.1 and Gradle 9.4.1 instead of the shell's 8.7.3 and 8.11.1, and JDK 17 or
    newer. The plugin compiles itself with a JDK 17 toolchain, so on a machine without JDK 17 the
    first build also downloads one (about 490 MB in `~/.gradle/jdks`), and Android build-tools
    36.0.0. Apps without native modules keep the shell's toolchain and generate the same project
    as before.

Native files import `react-native`, which a web-only checkout may not have. Keep them out of the
web type-check and check them on their own:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    /* ... */
  },
  "include": ["src"],
  "exclude": ["src/**/*.native.tsx", "src/**/*.android.tsx", "src/**/*.ios.tsx", "src/native"],
}
```

```jsonc
// tsconfig.native.json: tsc -p tsconfig.native.json, once react-native is installed
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "lib": ["ESNext"], "customConditions": ["react-native"] },
  "include": ["src/**/*.native.tsx", "src/**/*.android.tsx", "src/**/*.ios.tsx", "src/native"],
  "exclude": [],
}
```

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

Vue and Svelte pages are read too, `.vue` and `.svelte` components included, without the renderer's
compiler. Their scripts run on the server unless the page exports `hydrate = true`, so that export,
not a hook-shaped call, is what keeps a Vue or Svelte page off the native tier. Their markup gets
the element, class, inline-style, and form rules JSX does; a component's own `<style>` blocks count
as the app's CSS for its classes, and `v-html`, `{@html}`, bound classes and styles, `<component
:is>`, `<svelte:element>`, and tags that name no imported component keep the route web. `export
const mobile` goes in the module script (Vue's plain `<script>`, Svelte's `<script module>`).
React Native ports are React only, so a Vue or Svelte route is `native` or `web`.

The native tier looks only at the page and its app modules: the native shell draws the chrome, so
layouts are not part of a native screen. The report keeps the two lists apart, `nativeBlockers` for
the native tier and `blockers` for a React Native port, and the table shows the first blocker of the
tier to aim for.

Walking the AST, it visits each page, its app modules, and the layouts a `layout.native.tsx` does
not replace, and sorts what it finds into two buckets:

- **Ports:** `div`/`section`/… → View, `p`/`span`/headings → Text, `img` → Image, `button`/`a` →
  Pressable, text `input`/`textarea` → TextInput, `ul`/`ol` → List, and, for the native tier, a
  `form` with a URL action and its submit buttons and hidden fields; `@farm.js/ui` and
  `@farm.js/native`; `Link`, navigation hooks, and server function hooks from `@farm.js/core`; the
  flex, spacing, size, color, border, radius, and type Tailwind subset, with `dark:`; inline styles
  with those properties; `onClick`, and input change handlers; server function modules, which the
  screen calls over the network.
- **Blocks, so the route stays web:** `canvas`, `iframe`, `video`, `table`, `svg`, `select`;
  `dangerouslySetInnerHTML`, element refs, spread props, other DOM events; Sass and other non-CSS
  stylesheets, grid, `fixed`/`sticky`, transitions, responsive and `hover:` variants, arbitrary
  values, runtime class names; `window`, `document`, storage and observer APIs, `useLayoutEffect`,
  `createElement`; DOM packages and any package not on the list; server components, async pages,
  and Markdown pages.

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
- **Styles are the web page's**, in the browser's cascade order: the browser's default styles (or
  Tailwind's preflight), Tailwind utilities, the app's own rules, then the inline `style`. A
  production build links all of an app's CSS on every page, so the emitter reads every plain `.css`
  file the app imports and resolves each element's styles at build time, light and dark:
  - `@import "tailwindcss"` (Tailwind 4) turns on preflight, and each static `className` utility
    resolves through the same table as the [native tier](#server-rendered-native-screens),
    with the app's `@theme` on top: colors (`oklch`, hex, `rgb`), `--spacing`, text sizes and
    line heights, radii, weights, tracking, and `initial` resets. A value that reads a `:root`
    variable (`@theme inline { --color-surface: var(--surface) }`) takes its dark value from
    `prefers-color-scheme: dark`, so the class changes with the device theme;
  - the app's rules that match an element by its type and classes alone (`h1`, `.card`,
    `button.primary`, `*`, `:root`, `body`), with `inherit` (`font: inherit`) honored on form
    controls; `body` gives the screen its background, text style, and margin.

  A rule that also depends on where the element renders (`main h1`, `.card p`, `li + li`,
  attributes, `:first-child`) keeps the route web, unless it needs a class nothing around the page
  renders. With Tailwind loaded, a class neither the table nor the app's CSS knows keeps the route
  web too, since it may be a utility the table cannot draw.

- **Anything it cannot emit keeps the route web**, with the reason in the warning: class names built
  at runtime, `useContext`, server functions, `@farm.js/core` APIs other than `Link`,
  packages outside the pure list, asset imports and CSS module names, dynamic `import()`, and
  stylesheets that change what classes mean (`@utility`, `@custom-variant` such as a class-based
  dark mode, `@apply`, `@layer`, other `@import`s, Tailwind 3's `@tailwind`) or are not plain CSS.

Not yet: ports in `farm dev --mobile` (the analyzer runs in builds, so they show as web screens in
dev), `@theme` on server-rendered native screens (their classes use the default theme), iOS, `FlatList` for long lists, event bubbling from a child to a parent's `onClick`, and a
live light/dark switch (a screen takes the theme it opened with). The browser's default styles are
Chrome's, approximated.
