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
pnpm create @farm.js/app my-app
cd my-app
pnpm dev
```

The scaffolder installs React and all other starter dependencies automatically. Use
`--skip-install` if you only want it to generate the project files.

## What you get

- File-based routes in src/app.
- React rendering with pages, layouts, loading, error, and not-found boundaries.
- Typed Link hrefs generated from the route tree.
- API routes and a generated client for api.users.get style calls.
- Deployment output powered by Farm config instead of extra root files.

## Your first page

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

Integrations can contribute typed callers, routes, providers, middleware, storage schema, CLI registry components, config validation, and lifecycle hooks.

Use `farm add integration better-auth --ui` instead when the application needs to own a Better Auth instance, plugins, adapters, providers, or callbacks. The [Better Auth integration guide](/docs/integrations/auth/better-auth) and [Better Auth starter](https://github.com/farming-labs/farmjs-better-auth-starter) document that explicit path.

## Next steps

- Read Project Structure when you want the compact file layout.
- Read Routing and Layouts when you start nesting pages.
- Read API Routes and API Client when you need typed server/client calls.
- Read Integrations when provider features should be packaged instead of copied route-by-route.
