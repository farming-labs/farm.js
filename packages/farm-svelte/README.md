# @farm.js/svelte

Svelte 5 renderer for FARMJS applications, including component compilation, server rendering,
browser hydration, and `.svelte` route discovery.

```bash
pnpm add @farm.js/core @farm.js/svelte svelte
```

```ts
import { defineConfig } from "@farm.js/core";
import { svelte } from "@farm.js/svelte";

export default defineConfig({
  renderer: svelte(),
});
```

Create a complete starter:

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-svelte-app --template basic --renderer svelte --typescript
```

See the [Svelte renderer guide](https://farm.js.dev/docs/renderers/svelte) and the
[complete example](https://github.com/farming-labs/farm.js/tree/main/examples/svelte-renderer).
