# Farm Field Notes

One Farm app that is a normal web site in the browser and an Android and iOS app in Farm's native
shells.
Everything mobile is config: the `mobile` block in `farm.config.ts`, a page's
`export const mobile`, and screen files next to `page.tsx`. A web build never reads any of it.

```sh
pnpm dev                 # web
pnpm build && pnpm start # web production build
pnpm report              # farm config inspect --mobile --report
pnpm dev:mobile          # Android shell against the dev server (needs @farm.js/mobile, the SDK)
pnpm build:apk           # farm build --mobile --apk
pnpm dev:ios             # iOS shell on a booted simulator (needs Xcode; prints the steps without it)
pnpm build:ios           # farm build --mobile --os ios (Xcode project, simulator app with Xcode)
pnpm smoke               # checks the mobile decisions and the web build
```

## Routes

| Route                    | Shows                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| `/`                      | Home tab: a static page that links every demo, and an external link       |
| `/notes`                 | Notes tab: a server-rendered list                                         |
| `/settings`              | Settings tab: i18n (`en`, `es`) with a language switch                    |
| `/about`                 | A static push, from Home or Settings (each tab keeps its own stack)       |
| `/notes/[id]`            | A dynamic route pushed on the Notes tab                                   |
| `/notes/new`             | `export const mobile = { presentation: "modal" }`, a form that calls the `createNote` server function and pushes the new note |
| `/navigation`            | Navigations the shell takes (Link, anchors, `navigateTo`, router replace) and the ones it never sees (hash links, back, forward, document loads) |
| `/navigation/step/[n]`   | `mobile.routes` sets `presentation: "replace"`: the wizard renders in one screen |
| `/docs/[...slug]`        | A catch-all route                                                         |
| `/feed`                  | 240 rows, for scroll and frame-time checks                                |
| `/stations/[id]`         | A programmatic route (`src/farm.routes.tsx`) whose data comes from `data.main` |
| `/map`                   | `page.native.tsx`: a React Native list of stations from `GET /api/stations`; a row opens the web `/stations/[id]`; the device model from the app's `Device` module and a vibrate button. `mobile.native.routes` keeps it web on iOS |
| `/camera`                | `page.native.tsx` with a `page.android.tsx` override: notes from `GET /api/notes`, a quick note through the `createNote` server function called by import, and a button to the web `/notes/new` modal |
| `/settings/device`       | `page.kt`: a platform screen on Android                                   |
| `/lab/packing`           | Only portable elements and inline styles: the analyzer says `port`, and `farm build --mobile` generates its React Native port on Android |
| `/lab/chart`             | A canvas through a ref, a table, and `window`: the analyzer lists why it stays web |

`/map` and `/camera` are React Native screens built by `@farm.js/native` (Metro in
`pnpm dev:mobile`, Hermes bytecode in `pnpm build:apk`). They call public API routes only: native
screens send no cookies and no `Origin` header yet. `/settings/device` (`page.kt`) still shows a
placeholder: Farm does not build platform screens yet. Native files are type-checked on their own
(`tsconfig.native.json`), so the web `tsconfig.json` never needs `react-native`.

`mobile.native.auto` is `"on"`: the routes the analyzer proves render natively (`/`, `/notes`,
`/notes/[id]`, `/about`, `/feed`, `/navigation/step/[n]`, `/docs/[...slug]`) are `server` screens,
which the server renders and the Android shell draws with native views (iOS shows them as web
screens for now). `pnpm report` lists every route's tier. `/settings`, `/notes/new`, and
`/navigation` use client-side state and stay web.

`mobile.shells` is on: `pnpm build:mobile` renders `src/app/(styled)/loading.tsx` inside the
`(styled)` layout as one page shell for every styled route. The app shows it while a web screen's
document loads and keeps it while offline. `/lab/*` and `/stations/[id]` have no loading file
under their layouts, so they get none.

Verified with `pnpm dev:mobile` on an Android 15 emulator (SwiftShader software rendering, no GPU):

- `/map` (`page.native.tsx`) and `/camera` (`page.android.tsx`) render as React Native, `/map`
  with the stations from `GET /api/stations`.
- A row on `/map` pushes the web `/stations/[id]` in 120 to 134 ms, and the back gesture returns to
  the native list. `/camera` opens the web `/notes/new` modal, and back closes it. Tabs work.
- Fast Refresh works. React Native 0.88 runs on the example's React 19.2.8, with one React in the
  dev bundle.
- Cold start takes 1.4 to 2.9 s, with 84 to 198 ms of main-thread startup work. The React Native
  runtime warms up 1.2 to 5.0 s after the first paint, loading its bundle from Metro. The first
  `/map` open takes 611 to 1413 ms (103 to 797 ms on later opens), the first `/camera` open 184 to
  205 ms.
- The Hermes bytecode build takes 18.5 s in Metro and 1.6 s in `hermesc`, for 1.23 MB of bytecode
  and a 73.7 MB debug APK.

In a bytecode build (`pnpm build:apk`, a debug APK) against a local production server, `/map` opens
as React Native with its stations. Not verified yet: real devices, so the emulator numbers say
nothing about smoothness on a phone.

When a native screen throws while loading, a build shows its web version (`page.tsx`, the web
twin) and logs `<module id> failed to load: <error>` (`adb logcat -s FarmShell`). In
`pnpm dev:mobile`, React Native's error screen shows the error instead.

Building the native screens needs the Android NDK 27.1.12297006 (2.4 GB) and CMake 3.22.1 (94 MB),
which Gradle installs on the first build, for the 73 KB `libappmodules.so`.

`/map` also shows the network type and `isConnected` from `@react-native-community/netinfo`
(`testID="network-status"`), a community native module. Farm links the modules in the app's
`dependencies` into the Android app, so the example builds through React Native's Gradle plugin
(Android Gradle plugin 9.2.1, Gradle 9.4.1, JDK 17 or newer) instead of the shell's own toolchain.
Netinfo's `ACCESS_NETWORK_STATE` and `ACCESS_WIFI_STATE` permissions are granted at install, with
no prompt. On an Android 15 emulator, in `pnpm dev:mobile` and in a bytecode APK, `/map` shows
`wifi` and `true`, then `cellular` with Wi-Fi off and `none` and `false` with all networks off.

`/map` also uses the app's own native module, `Device` (`src/native/NativeDevice.ts`, a Codegen
spec, and `src/native/DeviceModule.kt`): it shows the phone's model (`testID="device-model"`) and
a button that vibrates for 200 ms (`testID="vibrate"`). `mobile.modules.Device.permissions` in
`farm.config.ts` adds `android.permission.VIBRATE` to the manifest, an install-time permission with
no prompt. Farm copies the module into `farm-app-modules/` in the generated project and links it
like netinfo. On an Android 15 emulator, in `pnpm dev:mobile` and in a bytecode APK, `/map` shows
the emulator's model (`sdk_gphone64_arm64`) and `Vibrate` vibrates for 200 ms with no error.
`src/native/` is type-checked with the native files (`tsconfig.native.json`).

React versions: this example pins `react` and `react-dom` 19.2.8, the version Farm core is tested
on. React Native 0.88 declares a `react@^19.3.0` peer (its renderer is built from 19.3.0), so pnpm
warns, but the native screens run on 19.2.8 in dev; `@farm.js/native` peers on `react@>=19.2.8`.
The web pages and the native screens share the example's one `react`. The example cannot move to
19.3 inside this workspace: `@farm.js/core` resolves its own 19.2.8 dev dependency here, so
`farm dev` server rendering would load two Reacts and every page fails. An app that installs Farm
from npm has one `react` (core only peers on it), so it can use 19.3 for both.

The root layout has no stylesheet, because the analyzer checks every layout above a route. Styled
routes import `globals.css` from the `(styled)` route group's layout; `/lab` routes use inline
styles. A production build still links `globals.css` on every page, `/lab` included, so the
generated port of `/lab/packing` applies its `body` and `input` rules too.

`mobile.server` defaults to `https://field-notes.farmjs.dev`; set `FIELD_NOTES_SERVER` to point
`farm build --mobile` at your own deployment.
