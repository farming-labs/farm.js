---
title: "The Web Shell"
description: "How web screens run in a Farm mobile app: the native navigator, the WebView pool, bundled client assets, page shells, and the bridge."
section: "Runtime"
---

# The Web Shell

Part of [Mobile Apps](/docs/mobile). Every route starts as a web screen: your page, loaded from
`mobile.server` into a WebView inside a native frame. Server rendering, auth, and data work exactly
as on the web, because it is the web.

## Navigation

The native navigator owns one stack per tab. Each screen is a native bar over one WebView, and
pushes, modals, replaces, and the back gesture are native transitions, not web history. An in-app
`Link` (or `navigateTo`, or a router `push`) is handed to the navigator, which opens the next screen,
web or native, by its route. Back and forward inside a page, same-page hashes, and `refresh()` stay
in the WebView. Links to other origins open in the system browser sheet.

The shell hooks in through [`delegateNavigation`](/docs/routing#navigation-delegates), a public core
API, so a plain browser runs your router unchanged.

## Fast opens

- **A pool of warm WebViews.** The shell keeps two WebViews preloaded with your client router, and
  starts them only after the first tab is ready. A push into a warm WebView is an in-place client
  navigation, which skips the WebView's roughly one second startup; if it fails, the screen loads
  the document normally.
- **Client files from the app (Android).** `farm build --mobile` copies the mobile client's
  content-hashed files into the APK, and the shell serves them from there. Only the document and
  data cross the network. A newer deployment's files load from the server, so the app always runs
  the client its server built. iOS loads them from the server, and WebKit caches them.
- **Page shells (opt-in).** See [below](#page-shells).

Deploy `farm build` as usual: an app with a `mobile` block also builds a mobile client next to the
web client, and the server gives it to documents the shell loads. An app without the block builds
exactly what it did before.

## Page shells

With `shells: true`, `farm build --mobile` bundles a **page shell** for each route: its layouts
around its `loading.tsx`, as HTML with no scripts. A cold open shows it at once, before the server
answers, and keeps showing it when the server cannot be reached.

```ts
export default defineConfig({
  mobile: {
    id: "com.example.notes",
    server: "https://notes.example.com",
    shells: true,
  },
});
```

- A route gets a shell when it has a `loading` file and neither that file nor any layout around
  the page sits in a `[param]` folder, since one shell serves every URL of the route. The build
  lists the routes that have a loading file but get no shell, and why.
- Shells render signed out, in the default locale, with no params or data. `<html>` gets
  `data-farm-page-shell`, so you can hide signed-in UI while one shows:

  ```css
  html[data-farm-page-shell] .account-menu {
    visibility: hidden;
  }
  ```

- A warm push never shows one, since it is already faster. If a document loads a different client
  build than the app's shells were made for, the app stops showing them until the versions match.
- Not yet: shells in `farm dev --mobile`, and shells for server components apps.

## The bridge

Pages from `mobile.server` get `window.__farmBridge`, which talks to the shell over a message
channel that accepts only your server's origin, on the main frame, so an embedded cross-origin
iframe cannot reach the app. It carries navigation and, for modules that opt in, calls from web
pages to [your native modules](/docs/mobile/modules#web-screens-call-app-modules).

## Limits

- Prerendered pages (`"use ssg"`) are static files, so in the app they load the web client and
  their links navigate inside the WebView.
- On the RSC pipeline, pages get the mobile client but each push loads its document, and
  `platform()` reports `"web"`.
- A document the WebView loads on its own (not through the shell) gets the web client until the
  next navigation.
