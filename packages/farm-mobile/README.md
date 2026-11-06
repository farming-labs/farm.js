# @farm.js/mobile

Mobile shells for Farm.js apps (preview). Each shell is a subpath, picked by `--os`:
`@farm.js/mobile/android` (the default) and `@farm.js/mobile/ios`.

```sh
pnpm add -D @farm.js/mobile
```

```ts
// farm.config.ts
export default defineConfig({
  mobile: {
    id: "com.example.notes",
    server: "https://notes.example.com",
    tabs: [
      { path: "/notes", title: "Notes", icon: "notes" },
      { path: "/settings", title: "Settings", icon: "settings" },
    ],
    routes: { "/notes/new": { presentation: "modal" } },
  },
});
```

```sh
farm dev --mobile          # dev server, Android project, install and open on an emulator or device
farm build --mobile        # mobile client build and Android project
farm build --mobile --apk  # also the debug APK
farm dev --mobile --os ios    # dev server, Xcode project, build and open on a booted simulator
farm build --mobile --os ios  # mobile client build and Xcode project (and the simulator app with Xcode)
```

## Android

On every run Farm writes a Gradle project to `.farm/output/mobile/android`: a Kotlin + Views
shell (AppCompat, Material, androidx.webkit, Custom Tabs) whose navigator reads
`farm-routes.json`. Tabs keep their own stacks, routes push, present as a modal, or replace by
rule, back is predictive, two pre-warmed WebViews back pushes, and links to other origins open in
Custom Tabs. A small bridge script, injected only into pages on the server's origin, receives the
navigations a `--mobile` client hands over with `delegateNavigation`.

Rules whose `screen` is `"native"` (`page.native.tsx`) are built as React Native surfaces in one
shared runtime by `@farm.js/native`; the project gets React Native only when such a route exists.
They run under `farm dev --mobile` on an Android emulator; production (Hermes bytecode) builds and
real devices are not verified yet. A screen that throws while loading shows React Native's error
screen in dev and its web twin (`page.tsx`) in builds. They send no cookies and no `Origin` header,
so they can only call public API routes for now. `"platform"` rules (`page.kt`)
open `FarmNativeScreens` screens by module id, such as `app/settings/device`; none are built yet, so
they show a placeholder that names the module.

The toolchain is JDK 17 or newer and the Android SDK (platform 35, build-tools 35,
platform-tools), found through `ANDROID_HOME`. Apps with React Native screens also use NDK
27.1.12297006 (2.4 GB) and CMake 3.22.1 (94 MB), which Gradle installs on the first build for
`libappmodules.so` (73 KB). That first build also downloads about 400 MB of React Native AARs; the
debug APK is about 73.7 MB unstripped and targets `arm64-v8a` and `x86_64` only (no 32-bit
devices).

## iOS

`--os ios` writes an Xcode project to `.farm/output/mobile/ios`: `App.xcodeproj` (written by Farm,
no XcodeGen or CocoaPods) and a Swift + UIKit shell for iOS 16 and newer that reads the same
`farm-routes.json`. A tab bar holds a navigation stack per tab, routes push, present as a sheet, or
replace by rule, back is the system swipe, two pre-warmed WKWebViews back pushes, and links to
other origins open in `SFSafariViewController`. The bridge script is the Android one
(`templates/shared/farm-bridge.js`), installed as a document-start `WKUserScript` on the server's
origin only; its `WKScriptMessageHandler` drops messages that are not from the main frame of that
origin. Native and platform rules show the same placeholder as on Android.

The generated project has not been built with `xcodebuild` yet: its Swift was type-checked
against the Mac Catalyst SDK and run as a Mac Catalyst app. Building needs Xcode with the iOS 16 or
newer SDK and an iOS simulator runtime. When `xcodebuild` and
`xcrun simctl` are missing, as with the Command Line Tools alone, `farm dev|build --mobile --os ios`
still writes the project and prints what to install and the commands to run.

## Page shells

With `mobile.shells: true`, `farm build --mobile` passes each route's page shell (its layouts
around `loading.tsx`, without scripts) in the shell context, and both shells bundle them under
`farm-shells/`. A cold document load shows the route's shell first: Android in a WebView without
JavaScript over the page until it paints, iOS with `loadHTMLString` (stylesheets inlined) before
the document. A warm push never shows one, and shells turn off while documents load another client
build. Not yet run on an emulator or simulator.

See the [Mobile Apps](https://farmjs.dev/docs/mobile) docs.
