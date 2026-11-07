---
title: "Native Device Features"
description: "Device APIs as React Native modules: community modules, the app's own TurboModules, mobile.modules, and the opt-in channel web screens call."
section: "Runtime"
---

# Native Device Features

Part of [Mobile Apps](/docs/mobile): how screens reach the camera, haptics, and the rest of the device.

## Native device features

A phone has capabilities a browser does not — the camera, SMS, contacts, sensors, push. Here is the
honest state of reaching them from a Farm app today, and where it is headed.

**Nothing ships automatically.** The generated app declares the `INTERNET` permission and the ones
[`mobile.modules`](#mobilemodules) lists, and the WebView is given no device APIs, so a web screen
has no `native.camera` or `native.sms` to call. Native screens reach device APIs through React
Native modules: community ones and [the app's own](#app-native-modules).

**Web screens reach the app's own modules when they opt in.** `native.<name>.<method>()` from
`@farm.js/core/native` sends the bridge's `call` message, and on Android the shell runs the Promise
methods of an app module with `mobile.modules.<name>.web: true`, checking the arguments against its
Codegen spec first (see [Web screens call app modules](#web-screens-call-app-modules)). Every other
call rejects with `NativeUnavailableError`. It is the right-hand channel in the
[architecture figure](/blog/web-to-native#on-the-device).

**Community React Native modules, on native screens.** A `page.native.tsx` screen can
use an installed React Native module, such as `@react-native-community/netinfo`, the same way a
React Native app does: add it to the app's `dependencies` and import it. Farm links the modules
into the Android app (see [React Native screens](/docs/mobile/native-screens#react-native-screens)); the permissions a module
declares in its own manifest are merged into the app's. On iOS, Farm compiles each module's podspec
`source_files` into the app and runs React Native's Codegen for it, without CocoaPods (see
[React Native screens on iOS](/docs/mobile#react-native-screens-on-ios)); modules with Swift sources
are not linked yet. Web screens cannot call these modules. Verified on an Android 15 emulator with netinfo 12.0.1, in
`farm dev --mobile` and in a bytecode APK: `/map` shows the connection type and `isConnected`, and
both change when Wi-Fi, mobile data, or airplane mode are switched off. Not verified yet: real
devices and Expo modules.

**Reaching a real device feature.** For something like reading SMS you drop to native code, where the
platform SDK is in reach:

- A **fully native screen** — `page.kt` (Kotlin + Jetpack Compose) or `page.swift` (Swift + SwiftUI) —
  is where you call `SmsManager`, `CameraX`, or `CLLocationManager` and declare the matching permission
  in the manifest. Farm hands the screen the `farm` object for route params, server calls, and
  navigation; the device API itself is ordinary native code you write. These screens are
  [designed but not built yet](/docs/mobile#native-screens): Farm records the route as `platform` and shows a
  placeholder.
- To ship one on a real app now, **eject** the generated project and register a screen in
  `FarmNativeScreens` — the one coded path to arbitrary platform APIs. You own that native code from
  then on.

**Web APIs are not a back door either.** The WebView enables only JavaScript and DOM storage, not
media or geolocation grants, so a web screen cannot quietly use `getUserMedia` or the Geolocation API.

In short: navigation, server data, and auth work across every screen today. Native screens can
use community React Native modules and the app's own. Web screens can call the Promise methods of
app modules that opt in, on Android and iOS; results by reference (files) and subscriptions
(events) are not built yet.

### App native modules

An app writes its own TurboModule the React Native way, in `src/native/`: a Codegen spec named
`Native<Something>.ts` and one Kotlin class. There is no Farm-specific spec format.

```ts
// src/native/NativeDevice.ts
import { TurboModuleRegistry, type TurboModule } from "react-native";

export interface Spec extends TurboModule {
  model(): Promise<string>;
  vibrate(ms: number): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>("Device");
```

```kotlin
// src/native/DeviceModule.kt
package com.example.notes

import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import dev.farmjs.mobile.specs.NativeDeviceSpec

class DeviceModule(reactContext: ReactApplicationContext) : NativeDeviceSpec(reactContext) {
    override fun model(promise: Promise) = promise.resolve(Build.MODEL)
    override fun vibrate(ms: Double, promise: Promise) { /* VibratorManager, then promise.resolve(null) */ }
}
```

A native screen imports the spec, as in a React Native app:

```tsx
// src/app/map/page.native.tsx
import { useEffect, useState } from "react";
import { Text } from "react-native";
import Device from "../../native/NativeDevice";

export default function MapScreen() {
  const [model, setModel] = useState("...");
  useEffect(() => {
    Device.model().then(setModel);
  }, []);
  return <Text>{model}</Text>;
}
```

What Farm does with it on Android, when the app has at least one React Native screen:

- It copies the specs and every `.kt` file in `src/native/` into a library in the generated
  project (`farm-app-modules/`) and adds that library to `autolinking.json`, the way it links a
  community module. React Native's Gradle plugin runs Codegen for the specs, builds the generated
  JNI code into `libappmodules.so`, and adds the library's package to `PackageList`. An app with app
  modules and no community modules switches to the plugin's toolchain too
  ([React Native screens](/docs/mobile/native-screens#react-native-screens)).
- Codegen writes each spec's base class to `dev.farmjs.mobile.specs`: `NativeDevice.ts` becomes
  `dev.farmjs.mobile.specs.NativeDeviceSpec`, with one abstract method per spec method (`number`
  is `Double`, a `Promise` return is a trailing `Promise` argument).
- A generated `FarmAppModulesPackage` registers the class that extends each spec's base class,
  under the name the spec registers (`"Device"`). The class takes a `ReactApplicationContext`.

The files are read directly from `src/native/` (not from subfolders). A spec must register its name
with `TurboModuleRegistry.getEnforcing<Spec>("Name")` (or `get`), each name once. On Android, every
spec needs exactly one Kotlin class that extends its base class, and every Kotlin file needs a
`package` line. Otherwise the command fails and names the file and the fix:

```text
src/native/NativeDevice.ts registers the native module "Device", but no Kotlin class in src/native extends NativeDeviceSpec. Add one, such as src/native/DeviceModule.kt with "class DeviceModule(reactContext: ReactApplicationContext) : NativeDeviceSpec(reactContext)" and "import dev.farmjs.mobile.specs.NativeDeviceSpec".
```

States:

| App has                                      | Generated Android project                                       |
| -------------------------------------------- | --------------------------------------------------------------- |
| No `src/native/` specs                       | Unchanged                                                       |
| Specs, but no React Native screen on Android | Unchanged: nothing on Android imports the modules               |
| Specs and a React Native screen              | `farm-app-modules/` linked through React Native's Gradle plugin |
| Kotlin or Swift files without a spec         | Unchanged: there is nothing to register                         |

On iOS, a module is an Objective-C++ class in `src/native/` (`*.mm`, with any `*.h`, `*.m` or
`*.swift` helpers) that adopts the `Native<Name>Spec` protocol Codegen generates from its spec into
`FarmAppSpec.h`, registers with `RCT_EXPORT_MODULE(<Name>)`, and returns its spec's JSI glue from
`getTurboModule:`, as `examples/mobile/src/native/DeviceModule.mm` does. With a React Native screen
on iOS the files are compiled into the app (`FarmModules/app/`); without one they are copied to
`FarmAppModules/` next to the Xcode project and not built.
Web screens call them only when they opt in (next section). Keep `src/native/` out of the web
`tsconfig.json`: specs import `react-native`.

Verified with `examples/mobile` on an Android 15 emulator (arm64), in a debug APK of Hermes
bytecode and under `farm dev --mobile`: Gradle runs Codegen for `farm-app-modules`,
`libappmodules.so` links `react_codegen_FarmAppSpec`, `/map` shows the emulator's `Build.MODEL`
(`sdk_gphone64_arm64`), `vibrate(200)` resolves and the vibrator service records a 200 ms
vibration, and `VIBRATE` is granted at install with no prompt. An app with app modules and no
community modules builds the same way. Not verified yet: real devices and a release (minified)
build.

### Web screens call app modules

A web screen (`page.tsx` in the shell's WebView) calls an app module through `native` from
`@farm.js/core/native`, once the module opts in:

```ts
// farm.config.ts
mobile: {
  modules: {
    Device: { permissions: ["android.permission.VIBRATE"], web: true },
  },
},
```

```tsx
// src/app/settings/device-card.tsx
"use client";

import { native } from "@farm.js/core/native";
import { useEffect, useState } from "react";

export function DeviceCard() {
  const [model, setModel] = useState("checking");
  useEffect(() => {
    if (!native.Device.available()) return setModel("not in the app");
    native.Device.model().then(setModel);
  }, []);
  return <p>Device: {model}</p>;
}
```

- **Promise methods only.** `native.Device.model()` reaches the spec's `model(): Promise<string>`.
  Synchronous methods, callbacks, and constants are not reachable from a web screen. An opted-in
  spec whose Promise method takes a callback, or that has no Promise method, fails the command and
  names the method.
- **App modules only.** `web: true` on a community module is a config error: its JavaScript runs
  on React Native's runtime, which a web screen does not have. Call it from a native screen.
- **Arguments are checked before the module runs.** Arguments go over the bridge as a JSON array.
  The generated Kotlin (Swift on iOS) checks each one against the spec's type (string, number,
  `Int32` as a whole number, boolean, string or number literal unions and enums, objects with their
  declared properties, `Object` maps, arrays of a type) and converts objects and arrays to
  `ReadableMap` and `ReadableArray` (dictionaries and arrays on iOS). A mismatch rejects with
  `invalid_args`, naming the argument; the module never sees it.
- **Object parameters are Android only.** Codegen passes a parameter of an object type with
  declared properties to Objective-C as a C++ struct, which the iOS shell does not build from JSON,
  so on iOS that method rejects with `native_unavailable`. Declare the parameter as `Object` to call
  it from web screens on both OSes; objects inside arrays and maps work on both.
- **The same module instance as native screens.** The call runs on the module React Native's
  runtime created for native screens, on its native-modules thread (on iOS, the module's method
  queue, by the selector Codegen gives the method). A call made before the runtime has warmed up
  starts it, as opening a native screen would, and waits until the bundle has loaded (up to 30 s on
  iOS).
- **`available()` first.** It is true only inside the mobile shell, for a module this build
  registered. In a browser, during server rendering, or for a module without `web`, it is false and
  calls reject with `NativeUnavailableError`. On iOS it is also false in an app without a React
  Native screen, and for a module with no Objective-C++ class adopting its spec's protocol.
- **Types come from the spec.** `farm generate` (and every dev start and build) adds each spec's
  Promise methods to `src/farm.d.ts` as `FarmNativeModules`, read with React Native's Codegen, so
  `native.Device.vibrate("200")` is a type error. Without `react-native` installed (a pruned
  production install) the section is left out; it only types web pages.
- **Free when unused.** `@farm.js/core/native` is its own entry with no imports. A web build that
  does not import it is unchanged, and the shells add no Kotlin or Swift for apps without a `web`
  module.

Rejections are a `NativeUnavailableError` (`code: "native_unavailable"`) or a `NativeCallError`
with the shell's or the module's code:

| `code`               | When                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `native_unavailable` | Outside the mobile shell, the module has no `web`, or React Native failed to start |
| `invalid_args`       | The arguments do not match the spec; the module did not run                        |
| `unknown_method`     | The spec has no Promise method by that name                                        |
| `native_error`       | The module threw                                                                   |
| The module's own     | The module called `promise.reject(code, message)`, such as `no_vibrator`           |

On Android this needs React Native in the app, which Farm adds when a route has a native screen
(`page.native.tsx`); `web: true` without one fails the command with that fix. On iOS, an app
without one, or without the module's Objective-C++ class, registers no module for web screens:
`available()` is false there, as in a browser. The bridge rules stay
those of [The bridge](/docs/mobile/shell#the-bridge): the server origin only, the main frame only, and only the
registered modules and the methods in their specs.

#### Files by reference

A large result, such as a photo, comes back as a URL, never as base64 through the bridge. The
module writes the file into `FarmFiles.directory(context)` (`cacheDir/farm-files`) and resolves
with its `file://` URI, as a React Native module does for native screens:

```ts
// src/native/NativeDevice.ts
export interface Spec extends TurboModule {
  /** The picked photo's file:// URI, or null when the user backs out. */
  pickPhoto(): Promise<string | null>;
}
```

```kotlin
// src/native/DeviceModule.kt (copying the system photo picker's result)
val file = File(FarmFiles.directory(reactApplicationContext), "photo-${UUID.randomUUID()}.jpg")
// ... write the photo to file ...
promise.resolve(Uri.fromFile(file).toString())
```

```tsx
// a web screen
const url = await native.Device.pickPhoto(); // "/__farm/files/Qm9...", or null
if (url) setPhoto(url); // <img src={photo} />, or fetch(url) to upload it
```

- **The bridge swaps the URI for a reference.** A `file://` URI inside `farm-files`, anywhere in a
  result (a string, or inside an object or array), reaches the page as `/__farm/files/<id>`: a path
  on the app's origin with a random 128-bit id. The page's WebView answers it from the file in
  `shouldInterceptRequest`, so a reference never goes to the server, and only bytes cross the
  process boundary, as for any image.
- **Scoped to the page that got it.** Another page's WebView answers the same path `404`. A page
  passes a reference back as an argument, and the module gets its `file://` URI again; a reference
  the page never received rejects with `invalid_args`.
- **Dropped when the screen closes.** The page's references stop working and their files are
  deleted, unless another open page holds the same file. Files left from an earlier run are
  deleted at launch. On a native screen the module's `file://` URI loads in `Image` as is.
- **Only `farm-files`.** Other `file://` URIs, `content://` URIs, and paths that leave the folder
  through `..` or a link stay plain strings, so a module that echoes a string cannot expose other
  app files. Copy a picked `content://` file into `farm-files` first, as `DeviceModule.kt` does.
- **Types stay the spec's.** A reference is a string, so the method returns `Promise<string>` (or
  an object with string properties); no Farm-specific spec type is needed.
- **Android only.** The iOS shell cannot answer `https` requests (WebKit's scheme handlers take
  only custom schemes), so on an iOS web screen a `file://` result reaches the page as a plain
  string it cannot load. Pick there with a file input: `PhotoPicker` without `pick`.
- Not yet: range requests (a long video loads whole).

[`PhotoPicker`](/docs/mobile#portable-components-farmjsui) from `@farm.js/ui` wraps this: given
`pick={native.Device.pickPhoto}` it calls the module, and in a browser it opens the file picker.

Not built yet: events as subscriptions, and file references on iOS.

Tested in unit and generator tests, and the generated Kotlin compiles against React Native
0.88.1's `react-android` and the Java specs Codegen generates; not run on a device or emulator yet.
On iOS, the `Mobile iOS` workflow opens `examples/mobile`'s `/settings` web screen on the
simulator under `farm dev --mobile --os ios` and checks that `native.Device.model()` answers.

### `mobile.modules`

What the OS needs for a module, keyed by module name: an app module's registered name (`"Device"`)
or a React Native package in the app's `dependencies`.

```ts
// farm.config.ts
mobile: {
  modules: {
    Device: { permissions: ["android.permission.VIBRATE"] },
    "react-native-vision-camera": {
      usage: { NSCameraUsageDescription: "Scans the receipts you attach to a note." },
    },
  },
},
```

| Option        | Notes                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `permissions` | Android permission names, such as `"android.permission.VIBRATE"`, added to `AndroidManifest.xml`        |
| `usage`       | iOS usage strings keyed by `NS...UsageDescription`, such as `NSCameraUsageDescription`, in `Info.plist` |
| `web`         | App modules only: `true` lets web screens call it ([details](#web-screens-call-app-modules))            |

- Without `modules`, or with entries that list no permissions, the manifest is the shell's own,
  with `INTERNET` only. Each permission is declared once, whichever modules list it.
- Without usage strings, `Info.plist` has none apart from the shell's own
  `NSLocalNetworkUsageDescription` under `farm dev --mobile`; a module's value for that key wins.
- A community module's own manifest permissions are merged into the app already, so list only the
  extra ones it asks the app to add. Farm keeps no table of which module needs which permission.
- A runtime permission, such as `android.permission.CAMERA`, is only declared: the module or the
  screen still asks the user for it (React Native's `PermissionsAndroid`). An install-time one,
  such as `VIBRATE`, is granted with the install.
- Usage strings are written to `Info.plist`, for the modules React Native screens use on iOS.

Every problem in `modules` is reported at once, each with its key and the fix:

```text
mobile (os: android): modules has 3 problems:
  - modules["Camera"] is not one of the app's native modules or an installed React Native module. Use the name a src/native/Native*.ts spec registers, or a package in dependencies in package.json.
  - modules["Device"].permissions[0] must be a full Android permission name such as "android.permission.VIBRATE", got "VIBRATE". Use "android.permission.VIBRATE".
  - modules["Device"].usage.Camera is not an iOS usage-description key. Keys are NS...UsageDescription, such as NSCameraUsageDescription.
```

A package in `dependencies` that is not installed, or that has no `codegenConfig` (not a React
Native module for the new architecture), is an error too, and so are two modules that set one usage
key to different strings. Usage keys outside the `NS...UsageDescription` pattern, such as
`NFCReaderUsageDescription`, are not accepted yet.
