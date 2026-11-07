# Trail Guide

The smallest Farm app that is also a native app. There is no native code in this folder: no
`page.native.tsx`, no React Native dependency, no Kotlin, no Swift. Every screen is a plain
`page.tsx` built from the portable [`@farm.js/ui`](../../packages/farm-ui) components, and the
build-time analyzer decides per route how native its screen can be.

For everything past this happy path — hand-written React Native screens, per-OS overrides, a
platform screen, native modules, auth — see [`examples/mobile`](../mobile), the complete example.

```sh
pnpm dev                 # web
pnpm build && pnpm start # web production build
pnpm report              # farm config inspect --mobile --report: each route's tier, and why
pnpm dev:mobile          # Android shell against the dev server (needs @farm.js/mobile, the SDK)
pnpm build:ios           # the Xcode project (a Mac with Xcode)
pnpm smoke               # checks the decisions below
```

## The three routes

| Route          | Written as                             | On mobile                                                                 |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| `/`            | `@farm.js/ui` components, static data  | **server screen**: the server renders the page, the shell draws native views, no JavaScript on the device |
| `/trails/[id]` | the same, with a dynamic param         | **server screen**: params resolve on the server, so dynamic routes stay portable |
| `/about`       | plain HTML with an inline `<svg>`      | **web screen**: native views cannot express the chart, and the report says exactly that |

The home page sets `export const mobile = { native: true }`, so if an edit ever makes it
unportable the build fails and names the blocker instead of quietly going web. The other routes
let the analyzer decide (`native.auto: "on"` in `farm.config.ts`).

The Mobile Android and Mobile iOS workflows build this example and launch it on an emulator and a
simulator, next to [`examples/mobile`](../mobile). Each run checks that `/` and `/trails/[id]` are
`server` screens and that the home screen drew native views without a web fallback, and keeps
`farm-routes.json`, the shell log, and home-screen screenshots as the `mobile-*-mobile-minimal-*`
artifact.

## What this example is for

- The authoring model's happy path: `page.tsx` is the web page, the mobile web screen, and —
  when it stays portable — the source of a native screen, all at once.
- `@farm.js/ui` as the portability line: the same `View`, `Text` and `List` render HTML on the
  web and native views on native screens, with tokens instead of CSS.
- The analyzer as the decision maker: `pnpm report` shows every route's tier and the exact
  reason, with file, line and column for each blocker.
