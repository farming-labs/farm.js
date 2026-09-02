# @farm.js/preact

Preact renderer adapter for FARMJS applications. It provides Preact JSX compilation, server
rendering and streaming, browser hydration, Prefresh, and React compatibility aliases.

```bash
pnpm add @farm.js/core @farm.js/preact preact
```

```ts
import { defineConfig } from "@farm.js/core";
import { preact } from "@farm.js/preact";

export default defineConfig({
  renderer: preact(),
});
```

Create a complete starter from the FARMJS CLI:

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-preact-app --template basic --renderer preact --typescript
```
