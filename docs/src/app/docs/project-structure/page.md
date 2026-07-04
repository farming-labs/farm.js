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
| src/farm-routes.d.ts | Generated typed route union for Link. |
| farm.config.ts | Framework config, integrations, docs, storage, deployment. |

## Optional files stay optional

Use vite.config.ts only when you need custom Vite behavior. Use platform files only when a deployment target requires provider-specific settings that Farm cannot infer.
