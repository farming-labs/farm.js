# `@farm.js/progress`

A top progress bar for Farm.js client navigations.

Client navigations otherwise give no visual feedback. This plugin shows a thin bar at the
top of the page while a navigation is in flight, completes it when the new page renders,
and flashes it red when the navigation fails. It is DOM-only and renderer-neutral.

```bash
pnpm add @farm.js/progress
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { progress } from "@farm.js/progress";

export default defineConfig({
  plugins: [progress()],
});
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { progress } from "@farm.js/progress";

export default defineConfig({
  plugins: [
    progress({
      delayMs: 150,
      color: "var(--accent)",
      height: 3,
    }),
  ],
});
```

## Options

| Option    | Default     | Description                                                             |
| --------- | ----------- | ----------------------------------------------------------------------- |
| `delayMs` | `150`       | Wait this long before showing the bar, so fast navigations never flash. |
| `color`   | `"#2563eb"` | Any CSS color for the bar, including a `var(--...)` token.              |
| `height`  | `3`         | Bar height in pixels.                                                   |

A failed navigation flashes the bar red and then hides it. The bar is removed when the
page closes or the plugin is replaced during development.
