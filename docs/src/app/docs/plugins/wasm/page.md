---
title: WebAssembly Plugin
description: Import prebuilt WebAssembly modules in browser code and browser workers.
section: Plugin Ecosystem
---

# WebAssembly

`@farm.js/wasm` connects WebAssembly ESM imports to Farm's development and production builds, including browser workers. Use it for compatible Wasm libraries that process images, parse files, run simulations, or perform other local computation.

The plugin handles loading and bundling. Your app supplies the library and its algorithms. Wasm alone does not move expensive work off the main thread; use a worker when the work would block interaction.

## Setup

```bash
pnpm add @farm.js/wasm
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { wasm } from "@farm.js/wasm";

export default defineConfig({
  plugins: [wasm()],
});
```

Adding `wasm()` is the opt-in. There is no separate `enabled` option. The plugin configures the loader for the browser and each worker build, preserves existing worker plugins, and uses ES-module workers.

It supports prebuilt `.wasm` ESM imports, including compatible `wasm-pack --target bundler` output. It does not compile Rust or C/C++. Packages that already initialize their own binary with `fetch`, or use Vite's `?init` / `?url` imports, may not need this plugin.

## Browser targets

Version one uses **native top-level await and module workers**, not a compatibility transformer.

| Option   | Meaning                                               | Default                                                                        |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `target` | Browser build target, as a string or array of strings | Your `vite.build.target`, otherwise Chrome/Edge 89, Firefox 114, and Safari 15 |

```ts
wasm({ target: ["chrome120", "firefox120", "safari17"] });
```

An explicit plugin target takes precedence over `vite.build.target`. The plugin does not change the server build target. These defaults describe the required module syntax and worker support, not every feature a third-party Wasm library might use. Targeting an older environment such as `es2020` produces a build error when top-level await is needed. `worker.format: "iife"` is rejected with an actionable error.

Test your actual library in the browsers you support. For example, older Safari versions have a [known limitation with multiple modules importing the same top-level-await module](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await#browser_compatibility). A compilation target is not a runtime compatibility polyfill.

## Load a module on demand

For a module exporting `add`, load it from a client event handler:

```tsx
"use client";

import { useState } from "react";

export default function Calculator() {
  const [result, setResult] = useState("Ready");

  async function calculate() {
    try {
      const { add } = await import("../wasm/math");
      setResult(`Result: ${add(20, 22)}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <button onClick={calculate}>Calculate</button>
      <output aria-live="polite">{result}</output>
    </>
  );
}
```

The example's local module re-exports a real binary:

```ts
// src/wasm/math.ts
export { add } from "./math.wasm";
```

```ts
// src/wasm/math.wasm.d.ts
export function add(left: number, right: number): number;
```

Those declarations must describe your binary's actual exports. Farm does not turn arbitrary Wasm exports into unchecked `any` types. For a published library, use its generated types and **import its documented JavaScript entry point** instead of bypassing its initialization or memory-management glue to import an internal binary.

Farm can also server-render client components. `"use client"` does not make a top-level import browser-only. Keep browser-dependent libraries inside client event handlers or effects; the plugin does not infer that boundary for you.

## Run expensive work in a worker

Register the listener before loading the async Wasm module so an early message is not lost during initialization:

```ts
// src/calculate.worker.ts
self.onmessage = async ({ data }: MessageEvent<{ left: number; right: number }>) => {
  try {
    const { add } = await import("./wasm/math");
    self.postMessage({ ok: true, value: add(data.left, data.right) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
```

Create the worker from browser code using Vite's statically discoverable URL syntax:

```ts
const worker = new Worker(new URL("./calculate.worker.ts", import.meta.url), {
  type: "module",
});

worker.onmessage = ({ data }) => {
  worker.terminate();
  if (data.ok) console.log(data.value);
  else console.error(data.error);
};
worker.onerror = (event) => {
  worker.terminate();
  console.error(event.message || "Worker could not load");
};
worker.postMessage({ left: 20, right: 22 });
```

Also terminate the worker when its owner unmounts or cancels. The [runnable example](https://github.com/farming-labs/farm.js/tree/main/examples/wasm-demo) includes cancellation, message-deserialization errors, repeated runs, and an intentional Wasm trap. Farm does not create a worker pool or wrap the standard Worker API.

## Deployment and limits

- Production emits Wasm and worker assets through Vite. Farm serves hashed assets at the origin root even when page routes use `basePath`; the example tests a page at `/lab/` loading those assets. Deploy the complete client output, not just JavaScript files.
- This plugin's supported scope is browser code and browser workers. It is renderer-neutral; the maintained example uses React. Server, edge, WASI, and Node-native package compatibility require separate testing and are not promised by this plugin.
- Loading, compilation, linking, and runtime errors still need application error handling. A missing binary, unsupported Wasm feature, or library-specific requirement is not silently ignored.
- A strict Content Security Policy may need `wasm-unsafe-eval` in `script-src` and an appropriate `worker-src`. The plugin never relaxes your security headers automatically.
- Threaded libraries using `SharedArrayBuffer` may need cross-origin isolation and additional setup. `wasm()` does not enable those headers or guarantee threaded-library compatibility.

The loading implementation is based on [vite-plugin-wasm](https://github.com/Menci/vite-plugin-wasm). See the [working demo](https://github.com/farming-labs/farm.js/tree/main/examples/wasm-demo) for the full executable setup.
