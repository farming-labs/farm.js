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
- **react-native** — a React Native screen ported from the page runs its logic on the device. This is the tier for pages that need interactivity — state, handlers — but still map to native. (Report-only today; the emitter that generates these screens is in progress.)
- **web** — a WebView of the page. The fallback, and the floor: every route works here.

A screen is one tier. Every route keeps its `page.tsx`, which stays the web version and the fallback, so adopting native is reversible and never leaves a screen with nothing to show.

<span id="how-the-analyzer-decides" className="blog-heading-anchor" />

## How the analyzer decides

At build time Farm parses each page into an abstract syntax tree with [Oxc](https://oxc.rs) and classifies every element, class name, inline style, and import. What it can map becomes a native view:

- `div`, `section`, headings → `View` and `Text`
- `img` → `Image`, `input` → `TextInput`, `ul`/`ol` → `List`, `button`/`a` → `Pressable`

What it can't map flags the route down a tier: `canvas`, `iframe`, `window`, `document`, arbitrary CSS values, server components, and anything that needs the browser. A page with only static, mappable content and no device JavaScript reaches **native**; add a hook or a handler and it is **react-native**; hit a hard blocker and it stays **web**.

The rule is deliberately conservative — **any doubt is web** — and every blocker is reported with its file, line, and column, so you can see exactly what keeps a screen off a tier.

<span id="try-it" className="blog-heading-anchor" />

## Try it

See what the analyzer decides for your own app:

```sh
farm config inspect --mobile --report   # each route's tier, and why
farm build --mobile                      # the Android project, native screens and all
```

Want a specific screen native? Ask for it, and the build fails with the exact blockers if it can't:

```tsx
// src/app/feed/page.tsx
export const mobile = { native: true };
```

The full tier rules, the mapping table, and the server-rendered native screens live in the [Mobile Apps](/docs/mobile) guide. Mobile is a preview — Android today, iOS and the React Native emitter on the way.
