# `@farm.js/analyzer`

Page-aware production build analysis for Farm.js.

```ts
import { defineConfig } from "@farm.js/core";
import { analyzer } from "@farm.js/analyzer";

export default defineConfig({
  plugins: [analyzer()],
});
```

Each successful production build writes `.farm/analyze.html`. Add concise limits when the build
should protect its size:

```ts
analyzer({
  json: true,
  limits: {
    page: "200kb",
    asset: "100kb",
  },
});
```

The report includes raw, gzip, and Brotli sizes for client bundles, server bundles, public assets,
and every emitted HTML page. Limits use gzip by default and fail the build when exceeded.

See the [Farm.js analyzer documentation](https://farmjs.dev/docs/plugins/analyzer) for all options.
