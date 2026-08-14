---
title: "Getting Started"
description: "Create a Farm.js app, understand the files that matter, and run the development server."
section: "Start"
---

# Getting Started

Create a Farm.js app, understand the files that matter, and run the development server.

## Create an app

Farm keeps the first project small: an app directory, a config file, package metadata, and TypeScript. Vite config and platform config are optional escape hatches, not required setup.

**Terminal**

```bash
pnpm create @farm.js/app@beta my-app --template basic --typescript
cd my-app
pnpm dev
```

This command follows the current `beta` dist-tag and explicitly selects the minimal Basic starter.
Use `pnpm create`, not `pnpm add`: pnpm resolves the `@farm.js/app` initializer name to the
published `@farm.js/create-app` package. The scaffolder installs React and all other starter
dependencies automatically. Use `--skip-install` if you only want it to generate the project
files.

React is the default renderer. The Basic starter can instead use Preact, Solid, Vue, or Svelte:

```bash
pnpm create @farm.js/app@beta my-preact-app --template basic --renderer preact --typescript
pnpm create @farm.js/app@beta my-solid-app --template basic --renderer solid --typescript
pnpm create @farm.js/app@beta my-vue-app --template basic --renderer vue --typescript
pnpm create @farm.js/app@beta my-svelte-app --template basic --renderer svelte --typescript
```

See [Renderers](/docs/renderers) before choosing an adapter. Integration starters currently use
React because their generated UI and provider packages are React-oriented.

## Choose a starter

Use `--list-templates` to see the same catalog in the terminal. Provider templates include the
integration wiring, an app-owned UI feature, `.env.example`, and a minimal dark home page.

| Template         | Included capability                     |
| ---------------- | --------------------------------------- |
| `basic`          | Minimal Farm.js app                     |
| `react-compiler` | Experimental React AOT compiler starter |
| `auth`           | Farm.js Auth                            |
| `better-auth`    | Better Auth                             |
| `ai`             | AI SDK chat                             |
| `auth0`          | Auth0                                   |
| `authjs`         | Auth.js with GitHub OAuth               |
| `autumn`         | Autumn billing                          |
| `clerk`          | Clerk                                   |
| `jobs-inngest`   | Inngest jobs                            |
| `jobs-trigger`   | Trigger.dev jobs                        |
| `polar`          | Polar billing                           |
| `resend`         | Resend email                            |
| `stripe`         | Stripe billing                          |
| `supabase`       | Supabase Auth                           |
| `unkey`          | Unkey API keys                          |
| `workos`         | WorkOS AuthKit                          |

For example:

```bash
pnpm create @farm.js/app@beta stripe-app --template stripe --typescript
```

The generated README lists the required environment values and links to the provider guide.

To explore Farm's experimental React AOT compiler with the shared dark starter UI:

```bash
pnpm create @farm.js/app@beta compiler-app --template react-compiler --typescript
```

The same project is available as the standalone
[React Compiler Starter](https://github.com/farming-labs/farmjs-react-compiler-starter).

## What you get

- File-based routes in src/app.
- Renderer-owned pages, layouts, loading, error, and not-found boundaries.
- Route types generated from the route tree.
- API routes and a generated client for api.users.get style calls.
- Deployment output powered by Farm config instead of extra root files.

## Your first page

The default starter uses React. Preact, Solid, Vue, and Svelte projects should follow their dedicated
[renderer guide](/docs/renderers) for the equivalent component file.

**src/app/page.tsx**

```tsx
import type { PageProps } from "@farm.js/core";

export default function HomePage(_props: PageProps) {
  return <h1>Hello from Farm.js</h1>;
}
```

## Add a layout

Every route can share chrome through `layout.tsx`. Start with a root layout, then add nested layouts only when a section needs its own navigation or data shell.

**src/app/layout.tsx**

```tsx
import type { LayoutProps } from "@farm.js/core";
import "./globals.css";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <main>
      <header>Farm.js</header>
      {children}
    </main>
  );
}
```

## Add an API route

Farm API routes live beside pages and use the same route tree. Define an endpoint, add Zod input when needed, then call it through the generated API client.

**src/app/api/hello/route.ts**

```ts
import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";

export const POST = createEndpoint(
  {
    method: "POST",
    body: z.object({
      name: z.string().min(1),
    }),
  },
  async ({ body }) => {
    return Response.json({
      message: `Hello ${body.name}`,
    });
  },
);
```

**src/components/hello-button.tsx**

```tsx
"use client";

import { apiClient } from "@/lib/api";

export function HelloButton() {
  return (
    <button
      onClick={async () => {
        const result = await apiClient.hello.post({
          body: { name: "Ada" },
        });

        console.log(result.data?.message);
      }}
    >
      Say hello
    </button>
  );
}
```

## Add authentication

For the default email/password flow, install the optional Farm Auth runtime and enable one config key:

```bash
pnpm add @farm.js/auth
```

```ts
export default defineConfig({
  auth: true,
});
```

The [Farm.js Auth Starter](https://github.com/farming-labs/farmjs-auth-starter) includes the complete forms, session UI, protected middleware, local SQLite setup, and production guidance.

## Add integrations later

Keep the first app small. When a feature becomes provider-shaped, add it as an integration:

```bash
farm add integration stripe --ui
farm add integration unkey
```

Integrations can contribute typed callers, routes, providers, middleware, database schemas, CLI registry components, config validation, and lifecycle hooks.

Use `farm add integration better-auth --ui` instead when the application needs to own a Better Auth instance, plugins, adapters, providers, or callbacks. The [Better Auth integration guide](/docs/integrations/auth/better-auth) and [Better Auth starter](https://github.com/farming-labs/farmjs-better-auth-starter) document that explicit path.

## Next steps

- Read Project Structure when you want the compact file layout.
- Read Renderers when choosing React, Preact, Solid, Vue, or Svelte for the component layer.
- Read Routing and Layouts when you start nesting pages.
- Read API Routes and API Client when you need typed server/client calls.
- Read Integrations when provider features should be packaged instead of copied route-by-route.
