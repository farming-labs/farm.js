# @farm.js/mobile

Mobile shells for Farm.js apps (preview). Each shell is a subpath, picked by OS. Android ships
first (`@farm.js/mobile/android`); there is no iOS shell yet.

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

See [Mobile (preview)](https://farmjs.dev/docs/desktop#mobile-preview) in the Desktop Apps docs.
