# @farm.js/core

The core of Farm.js, a full-stack framework for the web and agents. It owns app-directory routing in
`src/app`, server rendering with streaming, API routes, server functions and queries, middleware,
integrations, and the Vite and Nitro pipeline that turns an app into deployable output.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

Start a new app with the starter, which installs the dependencies for you:

```bash
pnpm create @farm.js/app my-app --template basic
```

To add Farm to an existing project:

```bash
pnpm add @farm.js/core react react-dom
pnpm add -D @farm.js/cli
```

Farm requires Node.js 22.13 or newer. `@farm.js/cli` provides the `farm` command. Every peer
dependency is optional: `react` and `react-dom` (18.2 or 19) are needed for the default React
renderer, and apps on another renderer install that renderer's package instead. Add the others only
when the app uses the feature:

| Package              | Needed for                                                      |
| -------------------- | --------------------------------------------------------------- |
| `@tailwindcss/vite`  | Built-in Tailwind CSS (a stylesheet imports `tailwindcss`)      |
| `@vercel/og`         | `opengraph-image` and `twitter-image` JSX, `@farm.js/core/og`   |
| `sharp`              | Image optimization on Node, Vercel, Netlify, and in development |
| `@farming-labs/docs` | The docs engine (`docs` enabled, or a `docs.config.*` file)     |

## Usage

A Farm app needs `src/app`, `farm.config.ts`, `package.json`, and `tsconfig.json`.

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  deploy: {
    target: "node",
  },
});
```

```tsx
// src/app/layout.tsx
import type { LayoutProps } from "@farm.js/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// src/app/page.tsx
import type { PageProps } from "@farm.js/core";

export default function HomePage(_props: PageProps) {
  return <h1>Hello from Farm.js</h1>;
}
```

```json
{
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .farm/.output/server/index.mjs"
  }
}
```

Run `pnpm dev`. Farm generates route, environment, and i18n types into `src/farm.d.ts` and keeps
them current while the dev server runs.

## What it provides

- **File routes.** Folders under `src/app` become URLs, with `page`, `layout`, `loading`, `error`,
  and `not-found` files, `[id]` and `[...slug]` segments, `(group)` folders, and `@slot` folders.
- **Rendering.** Pages render on the server, and React streams the HTML. Opt a route into static
  output with `export const dynamic = "force-static"` or into ISR with
  `export const revalidate = 300`. Partial Prerendering is experimental (`experimental.ppr`).
- **APIs and data.** `route.ts` files export HTTP methods built with `createEndpoint`, and
  `createApiClients` returns typed server and browser callers from the generated router.
  `createServerFn` and `createServerQuery` define validated server functions and cached reads.
- **Middleware.** Entries in `farm.config.ts` run first, then `src/app/**/middleware.ts` files from
  the root segment down, in development and production.
- **Integrations and plugins.** Provider packages mount through `integrations: { ... }` and
  framework extensions through `plugins: [ ... ]`.
- **Markdown mirrors.** Every page also answers as Markdown at its URL plus `.md`, for agents and
  crawlers.

```ts
// src/app/api/hello/route.ts
import { createEndpoint } from "@farm.js/core/api";

export const GET = createEndpoint(async () => Response.json({ message: "Hello" }));
```

Pass `body`, `query`, or `headers` schemas as the first argument to validate input before the
handler runs.

## Renderers

React is the default and is built into this package. Preact, Solid, Vue, and Svelte are beta
adapters selected with `renderer` (for example `renderer: vue()` from `@farm.js/vue`). Routing,
APIs, middleware, and deployment stay the same across renderers.

React Server Components are experimental and opt-in:

```ts
export default defineConfig({
  experimental: {
    serverComponents: true,
  },
});
```

When the RSC packages are missing, `farm dev` and `farm build` install them with the app's package
manager. CI never changes dependencies.

## Deployment

`deploy.target` maps to a Nitro preset. With no target, `farm build` writes a Node server to
`.farm/.output`, unless it detects a Vercel, Netlify, or Cloudflare Pages build environment. Other
Nitro presets pass through `deploy.preset` on a best-effort basis.

| Target       | Nitro preset       |
| ------------ | ------------------ |
| `node`       | `node-server`      |
| `vercel`     | `vercel`           |
| `cloudflare` | `cloudflare-pages` |
| `netlify`    | `netlify`          |

## Entry points

| Import                              | Use it for                                               |
| ----------------------------------- | -------------------------------------------------------- |
| `@farm.js/core`                     | `defineConfig` and types such as `PageProps`, `Metadata` |
| `@farm.js/core/api`                 | `createEndpoint` for `route.ts` handlers                 |
| `@farm.js/core/client`              | `Link`, `useRouter`, `createApiClients`                  |
| `@farm.js/core/navigation`          | `redirect`, `notFound`, `usePathname`, `useSearchParams` |
| `@farm.js/core/headers`             | `headers()`, `cookies()`, `getCspNonce()` on the server  |
| `@farm.js/core/server-fn`           | `createServerFn`                                         |
| `@farm.js/core/server-query`        | `createServerQuery`                                      |
| `@farm.js/core/server-query/client` | `useServerQuery`, `prefetchServerQuery`                  |

## Documentation

- [Getting Started](https://farmjs.dev/docs/getting-started)
- [Project Structure](https://farmjs.dev/docs/project-structure)
- [Routing](https://farmjs.dev/docs/routing)
- [Rendering Model](https://farmjs.dev/docs/server-rendering)
- [API Routes](https://farmjs.dev/docs/api-routes)
- [Server Queries](https://farmjs.dev/docs/server-queries)
- [Middleware](https://farmjs.dev/docs/middleware)
- [Configuration](https://farmjs.dev/docs/configuration)
- [Renderers](https://farmjs.dev/docs/renderers)
- [Deployment](https://farmjs.dev/docs/deployment)

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
