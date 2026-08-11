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
      layout.tsx # Preact/Solid also use TSX; Vue/Svelte use their component extensions
      page.tsx
  farm.config.ts
  package.json
  tsconfig.json
```

## Common folders

| Path           | Purpose                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| src/app        | Pages, nested layouts, API routes, route boundaries, middleware.             |
| src/client.ts  | Optional typed browser lifecycle for HTML-first application enhancements.    |
| src/lib        | Shared server and client utilities.                                          |
| src/components | Reusable UI and client components.                                           |
| layers         | Optional local Farm layers consumed through `extends`.                       |
| src/farm.d.ts  | Generated project types for routes, env, and i18n.                           |
| farm.config.ts | Framework config, integrations, docs, KV storage, databases, and deployment. |

## Optional files stay optional

Use vite.config.ts only when you need custom Vite behavior. Use platform files only when a deployment target requires provider-specific settings that Farm cannot infer.

## Route files

| File                                                         | Used for                                   |
| ------------------------------------------------------------ | ------------------------------------------ |
| `page.tsx` / `page.jsx` / `page.vue` / `page.svelte`         | The route UI for the selected renderer.    |
| `page.md` / `page.mdx`                                       | React-oriented Markdown-first app pages.   |
| `layout.tsx` / `layout.jsx` / `layout.vue` / `layout.svelte` | Shared shell for every child segment.      |
| `loading.*`                                                  | Pending UI for async route work.           |
| `error.*`                                                    | Segment-level error UI.                    |
| `not-found.*`                                                | Segment-level 404 UI.                      |
| `middleware.ts`                                              | Request behavior before the route renders. |
| `route.ts`                                                   | API handlers for the current URL segment.  |

Use `.tsx` or `.jsx` with React, Preact, and Solid, `.vue` with Vue, and `.svelte` with Svelte. See
[Renderers](/docs/renderers) for renderer-specific conventions and current feature boundaries.

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

## HTML-first client lifecycle

Add `src/client.ts` when server-rendered HTML needs small browser enhancements without turning a
page or layout into a hydrated component tree. Farm discovers the file at build time, includes it in
the existing client runtime, and invokes it on the initial document and fragment navigations.

```ts
import { defineClient } from "@farm.js/core/client/lifecycle";

export default defineClient({
  setup({ router }) {
    const controller = new AbortController();
    document.addEventListener(
      "click",
      (event) => {
        if (event.target instanceof Element && event.target.closest(".js-refresh")) {
          void router.refresh?.();
        }
      },
      { signal: controller.signal },
    );
    return controller;
  },
  close({ state }) {
    state.abort();
  },
});
```

The entry is ordinary typed TypeScript, not an inline script string. It does not hydrate the selected
renderer unless the application imports and mounts that renderer itself. Serializable values in
`publicRuntimeConfig` are provided as the typed `public` field of `setup`, so environment-derived
public endpoints can stay in `farm.config.ts`.

## Generated files

Farm keeps project-specific route, environment, and internationalization declarations in one generated `src/farm.d.ts` file. Static image declarations come from `@farm.js/core`, so they do not add another file to your source tree. Generated API clients remain in `src/lib/api.generated.ts` because applications import that module directly.

`farm dev` keeps generated types current as source files change; run the command manually when the dev server is not running.

**Terminal**

```bash
farm generate
```

Generated route types narrow route component props and make the React `Link` API stricter. Generated
API types make `api.hello.post(...)` match the route's body and query schemas in every renderer.

## When to add root files

| File                 | Add it when                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `vite.config.ts`     | You need Vite plugins, aliases, or server settings Farm does not infer.                                     |
| `vercel.json`        | You need platform behavior outside Farm's deploy output.                                                    |
| `tailwind.config.ts` | Your Tailwind version or design system requires an explicit config.                                         |
| `docs.config.ts`     | A large docs configuration is easier to maintain outside the canonical `docs` property in `farm.config.ts`. |
