---
title: "Route Runtime"
description: "Choose where dynamic pages and API routes execute, inherit deployment defaults from layouts, and set provider duration and region hints."
section: "Runtime"
---

# Route Runtime

Choose the execution runtime, regions, and maximum duration for dynamic pages and API routes. Farm uses one contract across file routes, programmatic routes, layouts, and `routeRules`.

## File pages

Export the controls next to the page that owns them. No wrapper or additional route file is required.

**src/app/reports/page.tsx**

```tsx
export const runtime = "node";
export const regions = ["iad1", "fra1"];
export const maxDuration = 30;

export default async function ReportsPage() {
  const reports = await getReports();
  return <Reports reports={reports} />;
}
```

`maxDuration` is measured in seconds. Region identifiers belong to the selected deployment provider; Farm validates the portable shape and lets the adapter interpret the identifiers.

## API routes

API files use the same exports.

**src/app/api/reports/route.ts**

```ts
export const runtime = "node";
export const regions = ["fra1"];
export const maxDuration = 15;

export async function GET() {
  return Response.json(await getReports());
}
```

Layouts do not wrap API handlers, so API routes inherit matching `routeRules`, then apply their own named exports.

## Layout defaults

A layout sets defaults for pages below its segment. The complete layout tree executes in the runtime selected for the final page.

**src/app/admin/layout.tsx**

```tsx
import type { LayoutProps } from "@farmjs/core";

export const runtime = "node";
export const regions = ["fra1"];
export const maxDuration = 60;

export default function AdminLayout({ children }: LayoutProps) {
  return <main>{children}</main>;
}
```

A child can override only the value it needs:

**src/app/admin/analytics/page.tsx**

```tsx
export const maxDuration = 20;

export default function AnalyticsPage() {
  return <Analytics />;
}
```

Farm resolves controls from lowest to highest precedence:

1. Broad matching `routeRules`
2. More-specific matching `routeRules`
3. Parent layouts
4. Nearest layout
5. `page.tsx` or API `route.ts`

## Reset inherited values

Use `"auto"` when a route should return to the deployment provider's default instead of inheriting a layout or rule.

```tsx
export const runtime = "auto";
export const regions = "auto";
export const maxDuration = "auto";
```

An omitted export inherits. An explicit `"auto"` resets.

## Programmatic routes

The same fields are typed on every programmatic primitive.

**src/farm.routes.tsx**

```tsx
import { defineRoutes } from "@farmjs/core";
import { ReportsPage } from "./features/reports/page";

export default defineRoutes(({ page, layout, api }) => [
  page("/reports", {
    runtime: "node",
    regions: ["iad1", "fra1"],
    maxDuration: 30,
    component: ReportsPage,
  }),
  layout("/admin", {
    runtime: "node",
    maxDuration: 60,
    component: AdminLayout,
  }),
  api("/api/reports", {
    runtime: "node",
    regions: ["fra1"],
    maxDuration: 15,
    GET: async () => Response.json(await getReports()),
  }),
]);
```

## Route rules

Use route rules when deployment policy belongs to a URL group rather than one source file.

**farm.config.ts**

```ts
import { defineConfig } from "@farmjs/core";

export default defineConfig({
  routeRules: {
    "/api/public/**": {
      runtime: "node",
      regions: ["iad1"],
      maxDuration: 10,
    },
    "/admin/**": {
      runtime: "node",
      regions: ["fra1"],
      maxDuration: 60,
    },
  },
});
```

Page, API, and layout values override matching rules. Rules still apply to generated integration endpoints that do not have a page file.

## Deployment behavior

Farm writes the normalized result to `.farm/route-runtime-manifest.json` on production builds. Custom deployment adapters can consume this manifest instead of parsing source files.

| Preset family      | Runtime accepted | `regions`                       | `maxDuration`                   |
| ------------------ | ---------------- | ------------------------------- | ------------------------------- |
| `vercel`           | `auto`, `node`   | Enforced per generated function | Enforced per generated function |
| Cloudflare presets | `auto`, `edge`   | Preserved for adapters          | Preserved for adapters          |
| `netlify`          | `auto`, `node`   | Preserved for adapters          | Preserved for adapters          |
| `netlify-edge`     | `auto`, `edge`   | Preserved for adapters          | Preserved for adapters          |
| `node-server`      | `auto`, `node`   | Preserved in the manifest       | Preserved in the manifest       |
| Custom preset      | Adapter-defined  | Preserved in the manifest       | Preserved in the manifest       |

For Vercel Node builds, Farm creates one Build Output API function per distinct region/duration policy and routes matching requests to it. Routes using provider defaults continue using the base function.

A production build fails when a dynamic route requests an incompatible runtime, such as `runtime = "edge"` with the Node-based `vercel` preset or `runtime = "node"` with a Cloudflare Worker preset. Farm warns when a valid runtime target cannot map a region or duration hint, while keeping the value available in the manifest.

Farm's current Vercel adapter emits Node functions. Use a supported Edge preset such as `cloudflare-module` or `netlify-edge` for `runtime = "edge"`; do not treat a Vercel region identifier as a portable Edge guarantee.

## Static routes and development

Static pages are generated during the build and do not have a request-time function. Runtime, region, and duration controls therefore do not change how a fully static page is served.

The local development server runs in Node so one process can provide HMR and route discovery. Runtime compatibility and provider output are enforced by `farm build`, which is the command CI should run before deployment.

## Practical guidance

- Keep functions close to their database, not necessarily close to every browser.
- Set `maxDuration` high enough for normal streaming responses but low enough to cap runaway work.
- Use `edge` only when the complete page, layout tree, middleware, and dependencies support Web APIs without Node-only modules.
- Prefer layout defaults for coherent application areas and route rules for generated or cross-cutting endpoints.
- Avoid configuring static pages unless the same policy also applies when the page becomes dynamic later.
