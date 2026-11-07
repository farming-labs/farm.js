---
title: "Your web app, native"
description: "Farm's analyzer reads each page and picks a tier: a native screen with no JavaScript, a React Native screen, or a web screen."
---

# Your web app, native

KinfeMichael Tariku · Nov 2026

You built your app for the web. With `farm build --mobile`, Farm wraps that same source in a native shell — native tabs, a stack per tab, predictive back — and shows each page on its own screen. By default a screen is your page in a WebView. But for the screens that can, Farm renders them as **real native views**, with no WebView at all.

Which screens? You do not decide that by hand. A build-time analyzer reads each page and picks a tier for it.

<BlogFigure kind="ast-native" caption="The analyzer maps each element to a native view, flags what it can't, and picks a tier per screen." />

<span id="the-three-tiers" className="blog-heading-anchor" />

## The three tiers

Every route gets a **tier** — the first one nothing rules out:

- **native** — the server renders the page into native views, with **no JavaScript on the device**. Async pages and server data are fine: they run on the server, exactly as they do for the web page. Ruled out by hooks, event handlers, `"use client"` modules, and anything the analyzer can't map.
- **react-native** — a React Native screen ported from the page runs its logic on the device. This is the tier for pages that need interactivity — state, handlers — but still map to native. (The emitter that generates these screens runs on an Android emulator today, not yet on a device.)
- **web** — a WebView of the page. The fallback, and the floor: every route works here.

A screen is one tier. Every route keeps its `page.tsx`, which stays the web version and the fallback, so adopting native is reversible and never leaves a screen with nothing to show. A page built from the portable [`@farm.js/ui`](/docs/mobile#portable-components-farmjsui) components ports as it is: on a React Native screen the same `View`, `Text`, and `List` render as native views, with their tokens resolved to the web defaults.

<span id="how-the-analyzer-decides" className="blog-heading-anchor" />

## How the analyzer decides

At build time Farm parses each page into an abstract syntax tree with [Oxc](https://oxc.rs) and classifies every element, class name, inline style, and import. What it can map becomes a native view:

- `div`, `section`, headings → `View` and `Text`
- `img` → `Image`, `input` → `TextInput`, `ul`/`ol` → `List`, `button`/`a` → `Pressable`

What it can't map flags the route down a tier: `canvas`, `iframe`, `window`, `document`, arbitrary CSS values, server components, and anything that needs the browser. A page with only static, mappable content and no device JavaScript reaches **native**; add a hook or a handler and it is **react-native**; hit a hard blocker and it stays **web**.

The rule is deliberately conservative — **any doubt is web** — and every blocker is reported with its file, line, and column, so you can see exactly what keeps a screen off a tier.

<span id="on-the-device" className="blog-heading-anchor" />

## On the device

The tier decides what a screen _is_. Here is how one _runs_. On the phone your app is a native shell — native tabs, a stack per tab — around a pool of WebViews, with a native **navigator** built from `farm-routes.json`.

<BlogFigure kind="mobile-arch" caption="A tap goes to the native navigator, which picks the screen by route. Every kind is served by your one backend: a web screen through the origin-scoped bridge, which also carries opt-in app-module calls; a server screen by fetching the page's rendered tree; and a React Native screen by calling the server functions it imports." />

A tap on a `Link` is handed to the shell, which asks the navigator what the route maps to:

- A **web screen** is a WebView showing your page from `mobile.server` — the **same backend, SSR, auth, and data** as the web. The shell and the page talk over an origin-scoped bridge (`window.__farmBridge`, main-frame only) that carries navigation, so an in-app link becomes a native push instead of a full document load.
- A **native screen** is drawn from the page your server renders — Android views today, and UIKit on iOS — with no JavaScript on the device. A **React Native** screen runs its logic on the device, and a **`page.kt` / `page.swift`** screen is where fully platform-native code will register. The navigator picks between them by route, the same way the web router does.

Because every screen is served by your one backend over HTTP, there is nothing to keep in sync: your server functions, queries, auth, and theme stay the app's, whatever a screen is made of.

The bridge also reserves a `native.<name>` channel for **device capabilities** — the camera, SMS, contacts. It ships no plugins yet, so those calls return `native_unavailable` today. How to reach a real device feature now, and where that channel is headed, is in [Native device features](/docs/mobile#native-device-features).

<span id="try-it" className="blog-heading-anchor" />

## Try it

See what the analyzer decides for your own app:

```sh
farm config inspect --mobile --report   # each route's tier, and why
farm build --mobile                      # the Android project, native screens and all
farm build --mobile --os ios             # the Xcode project; CI builds it and boots a simulator
```

Want a specific screen native? Ask for it, and the build fails with the exact blockers if it can't:

```tsx
// src/app/feed/page.tsx
export const mobile = { native: true };
```

The full tier rules, the mapping table, and the server-rendered native screens live in the [Mobile Apps](/docs/mobile) guide. Mobile is a preview — the Android shell ships today, and the rest is on `main` on its way to a release: the iOS shell builds with Xcode and draws native-tier pages with UIKit on a simulator in CI, and the React Native emitter runs on an Android emulator.
