---
title: "Native Device Features"
description: "Reach the camera, haptics, and other device APIs: React Native modules, the app's own native modules, and the opt-in channel web screens call."
section: "Runtime"
---

# Native Device Features

Part of [Mobile Apps](/docs/mobile). Device APIs are React Native modules. A
[React Native screen](/docs/mobile/native-screens#react-native-screens) can use any of them, and a
web screen can call the app's own modules when they opt in.

| You want to                          | Use                                                                  |
| ------------------------------------ | -------------------------------------------------------------------- |
| use a community module               | add it to `dependencies` and import it in a `page.native.tsx`        |
| write your own native code           | a TurboModule in `src/native/` ([below](#app-native-modules))        |
| call your module from a web page     | `mobile.modules.<name>.web` ([below](#web-screens-call-app-modules)) |
| declare permissions or usage strings | [`mobile.modules`](#mobilemodules)                                   |

Nothing is exposed by default. The app declares only `INTERNET` and what `mobile.modules` lists,
and the WebView gets no camera, microphone, or location grants, so a web page cannot use device
APIs unless a module you wrote lets it.

## Community modules

A `page.native.tsx` uses an installed React Native module, such as
`@react-native-community/netinfo`, as a React Native app does: add it to `dependencies` and import
it. Farm links it into the Android and iOS projects without CocoaPods, and merges the permissions in
its own manifest. A module must support React Native's new architecture (a `codegenConfig` in its
`package.json`); one that does not fails the build with its name.

## App native modules

Write a TurboModule the React Native way, in `src/native/`: a Codegen spec named
`Native<Name>.ts`, a Kotlin class for Android, and an Objective-C++ class for iOS.

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

On iOS, the module is a `*.mm` class that adopts the `NativeDeviceSpec` protocol Codegen generates,
registers with `RCT_EXPORT_MODULE(Device)`, and returns its JSI glue from `getTurboModule:`, as
`examples/mobile/src/native/DeviceModule.mm` does. A native screen imports the spec:

```tsx
// src/app/map/page.native.tsx
import Device from "../../native/NativeDevice";

const model = await Device.model();
```

Farm compiles the modules into the app only when it has a React Native screen. Each spec needs
exactly one Kotlin class extending its generated base class; otherwise the build fails and names
the file and the fix. Keep `src/native/` out of the web `tsconfig.json`, since specs import
`react-native`.

## Web screens call app modules

A web page calls an app module through `native` from `@farm.js/core/native`, once the module opts
in with `web: true`:

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

- **Check `available()` first.** It is true only inside the app, for a module with `web: true`. In
  a browser or during server rendering, calls reject with `NativeUnavailableError`.
- **Promise methods only**, typed from the spec in `src/farm.d.ts`, so a wrong argument is a type
  error. Arguments are checked against the spec again before the module runs.
- **App modules only.** Community modules run on React Native's runtime, which a web page does not
  have; call them from a native screen.
- **Free when unused.** A web build that never imports `@farm.js/core/native` is unchanged.

| `code`               | When                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| `native_unavailable` | Outside the app, the module has no `web`, or React Native did not start |
| `invalid_args`       | The arguments do not match the spec; the module did not run             |
| `unknown_method`     | The spec has no Promise method by that name                             |
| `native_error`       | The module threw                                                        |
| The module's own     | The module called `promise.reject(code, message)`                       |

**Large results, such as photos, come back as URLs** on Android. A module writes the file into
`cacheDir/farm-files` and resolves with its `file://` URI; the page receives a
`/__farm/files/<id>` path it can show in an `<img>` or upload with `fetch`. Only the page that got
the reference can load it, and the file is deleted when the screen closes.
[`PhotoPicker`](/docs/mobile/native-screens#portable-components) from `@farm.js/ui` wraps this.
iOS web screens receive the plain string for now, so pick photos there with a file input.

## `mobile.modules`

What the OS needs for each module, keyed by an app module's name or a React Native package in
`dependencies`:

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

| Option        | Notes                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| `permissions` | Android permission names, such as `"android.permission.VIBRATE"`, for the manifest |
| `usage`       | iOS usage strings keyed by `NS...UsageDescription`, for `Info.plist`               |
| `web`         | App modules only: `true` lets web pages call it                                    |

A runtime permission such as `android.permission.CAMERA` is only declared: the module or screen
still asks the user (React Native's `PermissionsAndroid`). Every problem in `modules` is reported
at once, each with its key and the fix.

## Not yet

Fully native `page.kt` and `page.swift` screens, which would call platform SDKs directly, are
planned. Until then, you can eject the generated project and register your own screen in
`FarmNativeScreens`. Event subscriptions from modules are not built yet.
