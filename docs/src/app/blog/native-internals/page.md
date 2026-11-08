---
title: "How Farm draws a page natively, and when it bails out"
description: "Inside Farm's native screens: the server reads page.tsx into a tree of native views, three layers of bailout fall back to the web page, and why this is not React Native's old bridge."
---

# How Farm draws a page natively, and when it bails out

KinfeMichael Tariku · Nov 2026

[Your web app, native](/blog/web-to-native) introduced the idea: a mobile build of a Farm app shows each route on its own native screen, and the screens that can are drawn with real native views instead of a WebView. This post is the engineering underneath. How a `page.tsx` becomes Android views and UIKit with no JavaScript on the phone. How Farm decides, three separate times, whether to bail out to the web page. And why sending a JSON tree from the server is not the bridge React Native spent years removing.

<span id="one-page-three-screens" className="blog-heading-anchor" />

## One page, three kinds of screen

Every route keeps its `page.tsx`. On a phone that one file can end up as one of three screens:

| Screen           | What draws it                                                   | JavaScript on the device     |
| ---------------- | --------------------------------------------------------------- | ---------------------------- |
| **web**          | the system WebView, loading the page from your server           | the page's own client bundle |
| **server**       | Android views or UIKit, from a tree the server renders          | none                         |
| **React Native** | a React Native surface, from `page.native.tsx` or a ported page | Hermes, on the device        |

Web is the floor: every route works there, and it is what everything below falls back to. The interesting tier is the middle one, because it gets a native screen out of an ordinary web page without shipping a JavaScript engine for it.

<span id="drawing-a-page-without-javascript" className="blog-heading-anchor" />

## Drawing a page without JavaScript

A server screen is not compiled ahead of time. The shell asks for it on every visit, the way a browser asks for a document, with one header changed:

```text
shell ── GET /notes  Accept: application/vnd.farm.native+json ──▶ your server
                                                                   renders /notes exactly as for a browser
shell ◀── { version: 1, root: { type: "View", … }, unsupported: [] } ── reads that HTML into a tree
```

The server runs the page through its normal request path: middleware, guards, data loading, async components, server components, all of it. The only difference is the last step. Instead of streaming the HTML to a browser, it reads the rendered HTML into a tree of five node types, `View`, `Text`, `Image`, `Pressable` and `TextInput`, plus the forms that submit them. That is the whole contract between the server and the phone.

A few details make that work on real pages:

- **Only the page, not the layout.** Layouts are web chrome: a header, a sidebar, web tabs. The native shell draws its own bar and tabs, so the tree should hold the page and nothing around it. The page's own output sits in a marked element (`__farm_page__`), and the reader starts there. The RSC pipeline adds that marker only for the tree's own render, and strips the header that asks for it from every outside request, so a browser never gets a marked page.
- **CSS is resolved on the server.** The reader cascades the stylesheets the page links, the same files a browser would get: type, class, id and attribute selectors, combinators, specificity, `:root` variables, `@media (prefers-color-scheme: dark)`. Tailwind classes resolve from Tailwind's theme, with colors converted from oklch to sRGB. Each node gets concrete values for light and dark, so the phone does no style resolution.
- **Text inherits like CSS.** Font, color and weight flow down to children as they do in a browser. Inline runs (a link or a `<strong>` inside a paragraph) stay inside their block, so a paragraph is one label with tappable ranges, not a row of fragments.
- **Accessibility comes from the markup.** Headings, `aria-label`, a field's `<label>` and `aria-hidden` become the platform's accessibility headings, labels and hidden flags, so TalkBack and VoiceOver read what a browser's screen reader would.

The shell then draws the tree with plain platform views: nested linear layouts on Android, stack views and attributed labels on iOS. Scrolling, text entry and pull to refresh are native, because they are native views. Nothing on the screen runs your code.

<span id="interactivity-without-javascript" className="blog-heading-anchor" />

## Interactivity without JavaScript

A screen with no JavaScript can still do what HTML does without JavaScript: follow links and submit forms. The shell submits a form the way a browser does. It sends the fields, the hidden inputs and the pressed button's `name` and `value` as `application/x-www-form-urlencoded` or `multipart/form-data`, with the page's `Origin` and the WebView's cookies. Then it draws whatever comes back. A redirect to the same page reloads it in place, a redirect elsewhere is a navigation, and a 4xx page with validation errors is drawn like any other page.

Server actions fall out of the same mechanism. React already renders `<form action={serverAction}>` as a form a browser can submit before hydration: a POST with hidden fields that name the action (`$ACTION_ID_…` with RSC, `$F_REF_…` with islx). The shell posts those fields like any others, and the server finds the action, runs its usual origin check, and answers. The action never runs on the phone, and there is no wrapper to write: the page that works in a browser with JavaScript disabled works on a server screen.

<span id="three-layers-of-bailout" className="blog-heading-anchor" />

## Three layers of bailout

A native screen is only worth having if it never shows something broken. So Farm checks three times, at three different moments, and any doubt sends the route to its web page. That fallback is the **web twin**: the same `page.tsx`, in a WebView.

<span id="layer-1-the-analyzer" className="blog-heading-anchor" />

### Layer 1: at build time, the analyzer

`farm build --mobile` parses every page with [Oxc](https://oxc.rs) and walks its syntax tree: each JSX element, class name, inline style, import and browser API is classified as something a native screen can express or something that rules a tier out. Hooks, event handlers and `"use client"` rule out the server tier, since they need JavaScript on the device. `canvas`, `iframe`, `dangerouslySetInnerHTML`, CSS grid and `window` rule out native altogether.

The result is a tier per route, and every blocker comes with a file, line and column:

```text
route        tier          reason
/settings    native        renders natively, no JavaScript on the device
/notes/[id]  web           src/app/notes/[id]/page.tsx:41:9 dangerouslySetInnerHTML
```

The rule is conservative on purpose: a route reaches a tier only when nothing rules it out. When you need a screen to be native, `export const mobile = { native: true }` turns the hope into a requirement. The build then fails with the blockers instead of quietly falling back. Results are cached by file content, so re-running the report is cheap. Vue and Svelte pages go through the same rules without their compilers: their scripts run on the server unless the page exports `hydrate = true`.

<span id="layer-2-every-request" className="blog-heading-anchor" />

### Layer 2: on every request, the tree

A build sees source, not data. A page that passed the analyzer can still render something on a given request that the tree cannot express: a class that only appears for some users, a CSS rule with no native equivalent, a form field type the shell does not draw. So the reader checks the actual output. Anything it cannot express goes into `unsupported`:

```json
{ "version": 1, "root": { "type": "View", "children": [] }, "unsupported": ["<canvas>"] }
```

A non-empty `unsupported` means the shell shows the web screen for that visit, and so does any answer that is not a tree: a failed request, or a redirect to a sign-in page. This is what makes the server tier safe for dynamic content. The bailout happens per request, so one odd record shows that record on the web without demoting the route for everyone.

<span id="layer-3-at-runtime" className="blog-heading-anchor" />

### Layer 3: at runtime, the web twin

React Native screens bail out on the device. If the runtime fails to start, the bundle is missing, or a screen throws while loading or rendering, the navigator shows the route's `page.tsx` in a WebView instead and logs why. In development, React Native's own error screen shows the error instead, so a bug is not hidden behind a working web page.

Put together, a route can only end up native when the build proved it could, this request's output agreed, and the device managed to draw it. Every other path ends at the web page, which already works.

<span id="isnt-this-the-bridge" className="blog-heading-anchor" />

## Isn't this the bridge React Native removed?

React Native's original architecture had a bridge: JavaScript and native code ran on separate threads and talked only through asynchronous, batched JSON messages. Every layout update, every touch event and every native module call was serialized, queued and deserialized on the other side. That was the bottleneck: a scroll handler or an animation driven from JavaScript paid for serialization on every frame, and nothing could be synchronous.

The New Architecture replaced it. **JSI** lets JavaScript hold direct references to C++ objects and call them synchronously, **Fabric** renders through it, **TurboModules** load native modules lazily through it, and since React Native 0.76 it is the default and runs "bridgeless". **Hermes** is a separate piece: it is the JavaScript engine (bytecode compiled ahead of time, fast startup), and it became the default engine before the bridge went away. So it is fairer to say React Native swapped the bridge for JSI and runs on Hermes.

A server screen sends JSON from the server to the phone, so the question is fair. The answer is that the bridge's problem was never JSON. It was chatty JSON on the hot path. Compare where the messages go:

|                                | React Native's old bridge                        | A Farm server screen                       |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------ |
| Messages per screen            | thousands: every layout pass, event, module call | one tree per visit, form submit or refresh |
| On the scroll and gesture path | yes                                              | no: scrolling is a native view             |
| JavaScript on the device       | yes, on its own thread                           | none                                       |
| Synchronous calls needed       | yes, and impossible over the bridge              | never: nothing runs on the device          |

A server screen pays for serialization exactly once, when it loads, which is the moment a web page pays for its HTML. After that, there is nothing to send and nothing to wait for until the user navigates or submits a form. That is the cost a browser already has, and no more.

The web screens have a bridge of their own, and it is narrow by design. A script defines `window.__farmBridge` on pages from your server, and messages travel over a WebView message listener that accepts only your server's origin, on the main frame. It deliberately avoids Android's `addJavascriptInterface`, which would answer every frame, cross-origin iframes included. The messages are coarse: a link tap handed to the native navigator, a frame painted, a title changed, an opt-in device module call. Like the server tree, it carries events a person causes, never per-frame work.

When a screen does need code on the device (state, gestures, animation), it is a React Native screen, and that runs on the New Architecture: Hermes, Fabric, bridgeless. One runtime is shared by every React Native screen, and it starts only after the first screen shows content. An app whose screens are all web or server pays nothing for it.

<span id="why-this-shape" className="blog-heading-anchor" />

## Why this shape

These were weighed and set aside (the full reasoning is in [RFC 0004](https://github.com/farming-labs/farm.js/pull/2352)):

- **A plain WebView wrapper.** Navigation, back gestures and tab bars feel like a website, and app review rejects apps that are only a wrapped site. Farm draws the navigation natively.
- **React Native for every screen.** Every app would pay React Native's size and startup for routes that gain nothing, and lose one implementation for web and mobile. On iOS, the example app with four React Native screens installs at 20.7 MB; the same shell without React Native is 0.4 MB.
- **Compile all of React DOM to native views.** That needs every DOM and CSS feature to have a native equivalent, which real apps break immediately. Proving portability per route, and keeping the web twin, gets native screens where they work and correct screens everywhere else.
- **Native views mixed into web pages.** A stock Android WebView cannot composite a native view into the page's layers, so it would float above the content and break gestures, scrolling and accessibility order. A screen's content is one tier.
- **Run the server on the phone.** Mobile OSes do not allow a reliable long-running local server, and server secrets would ship in the binary. Screens talk to the app's real server instead, the same one the web uses.

<span id="try-it" className="blog-heading-anchor" />

## Try it

```sh
farm config inspect --mobile --report   # each route's tier, and the first blocker
farm dev --mobile                        # Android emulator; --os ios for the simulator
```

Ask for a native screen and let the build tell you what is in the way:

```tsx
// src/app/settings/page.tsx
export const mobile = { native: true };
```

How to write pages that draw natively is in [Native Screens](/docs/mobile/native-screens). Mobile is a preview: the Android shell has shipped, and server screens, React Native screens and the iOS shell run on emulators and simulators in CI, not yet on devices.
