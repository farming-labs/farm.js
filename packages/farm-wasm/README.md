# @farm.js/wasm

Import prebuilt WebAssembly modules in Farm browser code and browser workers.

```sh
pnpm add @farm.js/wasm
```

```ts
import { defineConfig } from "@farm.js/core";
import { wasm } from "@farm.js/wasm";

export default defineConfig({
  plugins: [wasm()],
});
```

The plugin installs `vite-plugin-wasm` in both build pipelines, uses ES-module workers, and selects a browser target that supports native top-level await. The default is Chrome/Edge 89, Firefox 114, and Safari 15 unless your app supplies `vite.build.target`. Override it explicitly with `wasm({ target: ["chrome120", "firefox120", "safari17"] })`.

This is a browser loading/build plugin, not a Rust compiler, worker pool, or universal server/edge adapter. Import the JavaScript entry point supplied by your Wasm package when it has one. Keep browser-only imports inside client event handlers or effects.

- [Documentation](https://farmjs.dev/docs/plugins/wasm)
- [Runnable example](https://github.com/farming-labs/farm.js/tree/main/examples/wasm-demo)
