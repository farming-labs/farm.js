# RFC 0006: Platform screens (`page.kt`, `page.swift`)

- Status: Draft, open for discussion. Not scheduled; nothing here is being built.
- Split out of: [RFC 0004](./0004-platforms.md), section 7.2 ("Native screens: platform") and
  rollout step 11
- Scope: `@farm.js/core` mobile config and routing, `@farm.js/mobile` (Android and iOS projects),
  `@farm.js/cli`

## Summary

A platform screen is a route drawn by Kotlin with Jetpack Compose on Android and by Swift with
SwiftUI on iOS. It runs no JavaScript and does not depend on the app's renderer. RFC 0004 sketched
it as one tier among several. This RFC pulls it out on its own because the design has gaps that
should be closed before any code is written: who it is for, how it reaches the server, what happens
when it crashes, and what the development loop looks like.

## Where things stand

- The `mobile` config accepts the value: `mobile.native.routes[route].screen: "platform"` and
  `mobile.native.engine: "platform"` validate, and the route manifest records them.
- A route set to `"platform"` (or with a `page.kt` or `page.swift` file) opens a placeholder
  screen in both shells (`NativeScreens.kt`, `NativeScreens.swift`).
- Nothing compiles a `page.kt` or `page.swift`, and no Kotlin or Swift API (`FarmScreenScope`,
  `@FarmScreen`, generated server clients) exists.
- The escape hatch today is ejecting the generated project and registering a screen in
  `FarmNativeScreens` by hand.

## What already covers most cases

Before adding a fourth kind of screen, the three that ship should be the baseline:

| Need                                   | Today                                                      |
| -------------------------------------- | ---------------------------------------------------------- |
| Content, lists, detail pages, forms    | Native screens drawn from `page.tsx` (no JS on the device) |
| State, gestures, animation             | React Native screens (`page.native.tsx`)                   |
| A device API from a web or native page | App native modules (`src/native/`), `web: true` for web    |
| A fully custom native view             | Eject and register in `FarmNativeScreens`                  |

A platform screen is only worth adding for screens that need platform UI those cannot give: a
full-screen map or camera, a heavy list or editor that must feel native, or an app shipping
without React Native that still needs one native screen.

## Starting proposal (from RFC 0004)

```kotlin
// src/app/map/page.kt
@FarmScreen("/map")
@Composable
fun MapScreen(farm: FarmScreenScope) {
  val places by farm.query(FarmServer.listPlaces(region = farm.params["region"]))
  PlacesMap(places, onSelect = { farm.navigate("/places/${it.id}") })
}
```

```swift
// src/app/map/page.swift
@FarmScreen("/map")
struct MapScreen: View {
  @Environment(\.farm) private var farm
  var body: some View { PlacesMap(region: farm.params["region"]) }
}
```

- Found by file location in the route directory, or by `@FarmScreen("/route")` for a screen kept
  elsewhere. Two screens for one route on one OS is a build error.
- Server functions called through Kotlin and Swift clients generated from a server-function
  contract manifest, over the same transport as the web client.
- No JS engine: the screen adds its own code and nothing else.

This is a sketch, not a decision. The questions below decide whether it survives.

## Open questions

1. **Who asks for it.** Which real screens need this and cannot use the table above? Without a few
   concrete apps, the API will be designed in the abstract.
2. **Calling the server.** The proposal depends on generated Kotlin and Swift clients and a
   server-function contract manifest, neither of which exists. Options: generate typed clients,
   hand the screen a plain authenticated `fetch` to API routes, or both. Auth must reuse the
   device tokens native screens already send.
3. **Data and state.** Is there a `farm.query` with caching and invalidation shared with web
   screens, or does each screen manage its own? How do server actions and revalidation reach it?
4. **Navigation and chrome.** What the scope exposes: params, `navigate`, presentation, title, back,
   pull to refresh, and how it matches what web and native screens already do in the navigator.
5. **Failure.** A JS screen that throws falls back to its web twin. A Kotlin or Swift crash takes
   the process down. Is there any fallback, or is a platform screen simply trusted code?
6. **Build and dependencies.** Compose adds size and build time on Android; SwiftUI is free on iOS 16. How the files join the generated Gradle module and Xcode target, how app dependencies
   (Maven, Swift packages) are declared, and whether the `@FarmScreen` Swift macro is worth its
   toolchain cost over file location alone.
7. **Development loop.** No HMR: every edit is a Gradle or Xcode rebuild. Is that acceptable under
   `farm dev --mobile`, or do platform screens need their own fast path?
8. **Native-only routes.** A route with only `page.kt`/`page.swift` has no web page and no web twin.
   How it appears in route types, links from web pages, and deep links.
9. **Testing.** How an app tests a platform screen, and what Farm's own CI runs on the emulator
   and simulator.
10. **Analyzer stage 4.** RFC 0004 tied platform screens to emitting Compose and SwiftUI from the
    analyzer's IR. Hand-written platform screens and generated ones are different projects; this
    RFC proposes dropping generation from scope.
11. **The config values that exist today.** `screen: "platform"` and `engine: "platform"` validate
    and show a placeholder. Keep them reserved as they are, warn at build time that the route shows
    a placeholder, or reject them until this RFC is accepted.

## Alternatives

- **Do nothing; keep ejecting.** Ejecting already allows any native screen. The cost is losing
  regeneration, which is what makes Farm's shells maintainable.
- **Native islands only** (RFC 0004, 7.7). A native view (`Map`, `Video`, `CameraPreview`)
  embedded in a web or native screen covers many of the same needs without a screen-level API.
- **React Native screens with app native modules.** Already shipped; costs the React Native runtime
  but needs no new authoring model.

## Next steps

Collect use cases (question 1) and answer questions 2, 5 and 11 before any prototype. Until then,
the docs describe platform screens as under discussion here, not as planned.
