---
title: "Configuration"
description: "Use farm.config.ts as the single project control plane for source paths, integrations, docs, storage, deployment, and framework behavior."
section: "Start"
---

# Configuration

Use farm.config.ts as the single project control plane for source paths, integrations, docs, storage, deployment, and framework behavior.

## Define config

**farm.config.ts**

```ts
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
  srcDir: "src",
  deploy: {
    target: "vercel",
  },
  docs: {
    entry: "/docs",
  },
  md: {
    expose: ["/", "/pricing"],
    cache: 60,
  },
});
```

## Important options

| Option | Use it for |
| --- | --- |
| srcDir | Changing the app source folder from the default src. |
| integrations | Registering built-in or custom integrations. |
| storage | Providing storage clients and mounts for framework and integration code. |
| docs | Serving the built-in docs runtime and docs API. |
| md | Exposing markdown mirrors like /pricing.md. |
| deploy | Selecting a target, preset, and output directory. |
| openapi | Publishing API reference docs. |

## Next-style route exports

Farm route modules can expose compact rendering options directly on the page when the behavior belongs to that route.

**src/app/blog/page.tsx**

```tsx
export const dynamic = "force-static";
export const revalidate = 60;

export default async function BlogPage() {
  return <main>...</main>;
}
```
