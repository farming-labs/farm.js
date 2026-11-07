---
title: "The Web Shell"
description: "How a web screen runs on the device: the native navigator, the WebView pool, the origin-scoped bridge, bundled client assets, and page shells."
section: "Runtime"
---

# The Web Shell

Part of [Mobile Apps](/docs/mobile): what actually runs when a route stays a web screen.

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
- **`call`** — a call to a native module (`native.<name>.<method>()` from `@farm.js/core/native`),
  with a request id and the id of the document that sent it. On Android the shell dispatches it to
  the app modules with `mobile.modules.<name>.web` (see
  [Web screens call app modules](/docs/mobile/modules#web-screens-call-app-modules)) and answers when the module's
  Promise settles, only into the document that asked. Any other module answers
  `native_unavailable`; iOS registers none yet.

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
