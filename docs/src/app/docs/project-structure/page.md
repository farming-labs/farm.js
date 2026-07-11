---
title: "Project Structure"
description: "The compact file layout Farm expects, plus the optional files you add only when the app needs them."
section: "Start"
---

# Project Structure

The compact file layout Farm expects, plus the optional files you add only when the app needs them.

## Minimal shape

A Farm app can be as small as src, farm.config.ts, package.json, and tsconfig.json. The framework discovers pages, API routes, middleware, layouts, docs, markdown mirrors, and generated route types from there.

**Minimal app**

```txt
my-app/
  src/
    app/
      layout.tsx
      page.tsx
  farm.config.ts
  package.json
  tsconfig.json
```

## Common folders

| Path | Purpose |
| --- | --- |
| src/app | Pages, nested layouts, API routes, route boundaries, middleware. |
| src/lib | Shared server and client utilities. |
| src/components | Reusable UI and client components. |
| layers | Optional local Farm layers consumed through `extends`. |
| src/farm-routes.d.ts | Generated typed route union for Link. |
| farm.config.ts | Framework config, integrations, docs, storage, deployment. |

## Optional files stay optional

Use vite.config.ts only when you need custom Vite behavior. Use platform files only when a deployment target requires provider-specific settings that Farm cannot infer.

## Route files

| File | Used for |
| --- | --- |
| `page.tsx` | The route UI. |
| `page.md` / `page.mdx` | Markdown-first static app pages. |
| `layout.tsx` | Shared shell for every child segment. |
| `loading.tsx` | Pending UI for async route work. |
| `error.tsx` | Segment-level error UI. |
| `not-found.tsx` | Segment-level 404 UI. |
| `middleware.ts` | Request behavior before the route renders. |
| `route.ts` | API handlers for the current URL segment. |

## Recommended app layout

**Project**

```txt
my-app/
  src/
    app/
      api/
        hello/
          route.ts
      dashboard/
        layout.tsx
        page.tsx
      about/
        page.mdx
      layout.tsx
      page.tsx
    components/
      account-menu.tsx
    lib/
      api.ts
      integrations.ts
  farm.config.ts
  package.json
  tsconfig.json
```

Keep framework configuration in `farm.config.ts`. Keep application helpers under `src/lib`, and keep UI that is reused across pages under `src/components`.

Reusable product areas can live under `layers/<name>` with their own optional `farm.config.ts` and `src` directory. The application enables them explicitly through `extends`; see [Layers](/docs/layers).

## Generated files

Farm generates route and API types from the app tree. `farm dev` keeps them current as page and API route files change; run the command manually when the dev server is not running.

**Terminal**

```bash
farm generate
```

Generated route types make `Link` stricter, and generated API types make `api.hello.post(...)` match the route's body and query schemas.

## When to add root files

| File | Add it when |
| --- | --- |
| `vite.config.ts` | You need Vite plugins, aliases, or server settings Farm does not infer. |
| `vercel.json` | You need platform behavior outside Farm's deploy output. |
| `tailwind.config.ts` | Your Tailwind version or design system requires an explicit config. |
| `docs.config.ts` | You enable docs and want navigation, icons, theme, or page actions. |
