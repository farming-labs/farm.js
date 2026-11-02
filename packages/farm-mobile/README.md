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

Rules whose `screen` is `"native"` (`page.native.tsx`) or `"platform"` (`page.kt`) open
`FarmNativeScreens` screens by module id, such as `app/notes/[id]`, tab roots included. None are
built yet, so they show a placeholder that names the module.

The toolchain is JDK 17 or newer and the Android SDK (platform 35, build-tools 35,
platform-tools), found through `ANDROID_HOME`.

## iOS

`--os ios` writes an Xcode project to `.farm/output/mobile/ios`: `App.xcodeproj` (written by Farm,
no XcodeGen or CocoaPods) and a Swift + UIKit shell for iOS 16 and newer that reads the same
`farm-routes.json`. A tab bar holds a navigation stack per tab, routes push, present as a sheet, or
replace by rule, back is the system swipe, two pre-warmed WKWebViews back pushes, and links to
other origins open in `SFSafariViewController`. The bridge script is the Android one
(`templates/shared/farm-bridge.js`), installed as a document-start `WKUserScript` on the server's
origin only; its `WKScriptMessageHandler` drops messages that are not from the main frame of that
origin. Native and platform rules show the same placeholder as on Android.

Building needs Xcode 15 or newer with an iOS simulator runtime. When `xcodebuild` and
`xcrun simctl` are missing, as with the Command Line Tools alone, `farm dev|build --mobile --os ios`
still writes the project and prints what to install and the commands to run.

See the [Mobile Apps](https://farmjs.dev/docs/mobile) docs.
