---
title: "Layers"
description: "Compose reusable Farm application directories and packages with predictable project overrides."
section: "Start"
---

# Layers

Farm layers let an application inherit routes, layouts, middleware, plugins, integrations, components, configuration defaults, and generated types from ordinary Farm-shaped directories or installed packages.

A layer does not call a special registration function. The consuming application's `extends` array is what makes a directory or package a layer.

## Consume layers

```ts
import { defineConfig } from "@farmjs/core";

export default defineConfig({
  extends: ["@company/farm-base", "@company/admin-layer", "./layers/commerce"],
});
```

Farm applies entries from left to right. In this example, `admin-layer` can override `farm-base`, `commerce` can override both, and the current project has final priority.

## Declare a layer

A local layer uses the same shape as a small Farm application:

```txt
layers/commerce/
  farm.config.ts
  src/
    app/
      products/
        page.tsx
      cart/
        page.tsx
      checkout/
        layout.tsx
        page.tsx
    components/
      ProductPrice.tsx
    farm.routes.tsx
```

`farm.config.ts` is optional. When present, it exports a plain object:

```ts
import type { FarmLayerConfig } from "@farmjs/core";
import { commercePlugin } from "./src/plugin";

export default {
  plugins: [commercePlugin()],

  routeRules: {
    "/products/**": { swr: 300 },
    "/checkout/**": { render: "dynamic" },
  },
} satisfies FarmLayerConfig;
```

`FarmLayerConfig` is an optional type-only helper. A plain default object works without importing anything, and `defineConfig` works too. There is no `defineFarmLayer` API.

## Override layer files

Suppose `commerce` provides:

```txt
layers/commerce/src/app/products/page.tsx
```

The project replaces only that page by creating:

```txt
src/app/products/page.tsx
```

The layer's product layout, loading boundary, middleware, API routes, and unrelated pages remain active. The same rule applies between layers: a later source replaces an earlier file with the same virtual route and file kind.

Duplicate routes inside one source are errors. A duplicate across sources is an intentional override.

## Import layer components

Each layer receives an alias derived from its directory or package name:

```tsx
import ProductPrice from "#layers/commerce/components/ProductPrice";
import AdminNavigation from "#layers/admin-layer/components/AdminNavigation";
```

Layer-owned files can continue using ordinary relative imports. Published packages may additionally expose components through their normal package exports.

## Publish a package layer

An installed package needs no Farm-specific manifest:

```txt
@company/admin-layer/
  package.json
  farm.config.js
  src/
    app/
      admin/
        layout.tsx
        page.tsx
        users/page.tsx
    components/
      AdminNavigation.tsx
```

Ensure the published package includes `farm.config.*` and its source directory. Farm resolves the package root, loads the optional config, and scans its source just like a local layer.

## Configuration composition

| Configuration                      | Behavior                                                        |
| ---------------------------------- | --------------------------------------------------------------- |
| Scalar values                      | The later layer or project value wins.                          |
| Plain objects                      | Deeply merged; later keys win.                                  |
| `plugins`                          | Appended from the lowest layer through the project.             |
| `middleware` config                | Appended in layer order.                                        |
| `redirects`, `rewrites`, `headers` | Results are appended in layer order.                            |
| Other arrays                       | Replaced by the later value.                                    |
| Integrations                       | Merged by integration name; later definitions win.              |
| Environment schemas                | Merged by server/public key; project definitions win conflicts. |

The resolved package or directory root and its layer-local `srcDir` locate that layer's files. Build ownership stays with the project, so layers cannot replace project `root`, `outDir`, `distDir`, deployment target, output mode, public directory, preset, or build ID generator.

Security-sensitive arrays such as `serverActions.allowedOrigins` are replaced rather than concatenated. A project can therefore replace an inherited allowlist without accidentally appending to it.

## Generated types

Farm generates route, API, environment, and static image types from the final resolved application graph. Layer routes appear in typed `Link` values, layer APIs appear in the generated API client, layer environment schemas participate in `getEnv` autocomplete, and raster imports carry image dimensions.

When a project overrides a layer API route, generated API types import the project implementation. Layer-owned routes that remain active keep type-only imports to their real package or directory files.

## Nested layers

A layer can extend lower-level layers using the same property:

```ts
// layers/commerce/farm.config.ts
export default {
  extends: ["@company/domain-base"],
};
```

Nested paths resolve relative to the layer that declares them. Farm deduplicates repeated layers and reports a readable error when it finds a cycle.

## Development behavior

Adding or removing layer pages, layouts, boundaries, APIs, middleware, or programmatic route files refreshes route discovery and generated types. Editing an imported module uses normal Vite HMR.

Restart the development server after changing `extends`, a layer's `srcDir`, or layer configuration that changes the resolved plugin/config graph.

## Best practices

- Keep base layers broad and feature layers focused on one domain.
- Put application-specific behavior in the project, where override intent is visible.
- Prefer package versions or workspace dependencies over unpinned remote source.
- Treat a layer as trusted executable code because its config, plugins, middleware, and server routes run inside the application.
- Keep authentication and authorization inside inherited APIs and server functions; consuming a layer does not create a security boundary.
