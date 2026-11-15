---
title: "Migrations"
description: "Move apps from Next.js, TanStack Start, SvelteKit, and Nuxt to Farm with source-specific guides and agent-ready parity references."
section: "Migrations"
---

# Migrations

Move an existing app to Farm with a source-specific guide. This section covers every framework in
the homepage comparison: Next.js, SvelteKit, Nuxt, and TanStack Start.

## Choose a source

React apps keep their components, since React is Farm's default renderer. Nuxt applications can retain Vue SFCs through `@farm.js/vue`,
and SvelteKit applications can retain Svelte components through `@farm.js/svelte` while their
framework-specific modules are adapted.

| Source                                      | Renderer          | Guide covers                                                                        |
| ------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| [Next.js](/docs/migrations/nextjs)          | React (built in)  | App Router files, server actions, route handlers, metadata, middleware, and config. |
| [TanStack Start](/docs/migrations/tanstack) | React (built in)  | File routes, the root route, loaders, server functions, and server routes.          |
| [SvelteKit](/docs/migrations/sveltekit)     | `@farm.js/svelte` | Routes, layouts, load functions, form actions, endpoints, hooks, and adapters.      |
| [Nuxt](/docs/migrations/nuxt)               | `@farm.js/vue`    | Pages, layouts, server routes, data composables, middleware, and runtime config.    |

## Migrate with a coding agent

Every guide has an expanded Markdown version written for coding agents. It maps each feature of
the source framework to its Farm equivalent, marks what works unchanged, what needs a rewrite, and
what has no direct equivalent, and ends with a verification checklist.

Request any guide with a `.md` suffix, or send `Accept: text/markdown`:

```bash
curl https://farmjs.dev/docs/migrations/nextjs.md
```

Then hand the URL to your agent:

```txt
Migrate this app to Farm. Follow https://farmjs.dev/docs/migrations/nextjs.md and run its
verification checklist before removing Next.js.
```

Replace `nextjs` with `tanstack`, `sveltekit`, or `nuxt` for the other sources.

## Workflow

Each guide works as a checklist:

1. Create a branch and keep the existing app runnable.
2. Add Farm and the matching renderer, and create `farm.config.ts`.
3. Move routes into `src/app`, starting with the root layout.
4. Replace framework-specific imports, data loading, mutations, and middleware one feature at a time.
5. Run the app in development and production, and compare every route with the old app.
6. Remove the previous framework only after the Farm build behaves the same in production.

## Ground rules

- Farm's app directory is `src/app`, and the `@/` import alias points at `src`.
- Production output lives in `.farm/.output`. The start script is
  `node .farm/.output/server/index.mjs`, the same as in new Farm projects.
- Delete the previous framework's `vite.config.*` once its plugins are no longer needed. Move any
  options you still want into the `vite` field of `farm.config.ts`.
- Pin exact Farm versions. Package managers with a minimum release age, such as pnpm 11 and later,
  can resolve `latest` to an older release for a day after a publish.
- Unsupported APIs should be rewritten deliberately rather than shimmed. Each guide lists the
  closest Farm equivalent.
