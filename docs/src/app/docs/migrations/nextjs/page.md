---
title: "Migrate from Next.js"
description: "Move a Next.js App Router project to Farm: routes, server actions, route handlers, middleware, metadata, and Next.js modules."
section: "Migrations"
---

# Migrate from Next.js

Farm uses the same App Router file shape for pages, layouts, loading states, errors, not-found
pages, and route handlers, so most of the route tree moves without redesign. The work is in the
pieces around it: Next.js modules, server actions, middleware, and `next.config`.

> **Using a coding agent?**
>
> Point it at [`/docs/migrations/nextjs.md`](/docs/migrations/nextjs.md). That version maps every
> App Router feature to its Farm equivalent, with before and after code, failure symptoms, and a
> verification checklist.

## Set up Farm

Work on a branch and keep the Next.js app runnable until the Farm build matches it. React is Farm's
default renderer, so no renderer package is needed:

```bash
pnpm add @farm.js/core
pnpm add -D @farm.js/cli
```

Pin exact versions in `package.json`. Package managers with a minimum release age, such as pnpm 11
and later, can resolve `latest` to an older Farm release for a day after a publish.

Create `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({});
```

Point the scripts at Farm:

```json
{
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .farm/.output/server/index.mjs"
  }
}
```

## Move files

Farm's app directory is `src/app`, and the `@/` alias resolves to `src`.

| Next.js                                 | Farm                                        |
| --------------------------------------- | ------------------------------------------- |
| `app/**`                                | `src/app/**`                                |
| `components/`, `lib/`, `hooks/` at root | `src/components/`, `src/lib/`, `src/hooks/` |
| `app/api/**/route.ts`                   | `src/app/api/**/route.ts`                   |
| `route.ts` outside `app/api`            | `defineRoutes` in `src/routes.ts`           |
| `middleware.ts` or `proxy.ts` (Next 16) | `src/app/middleware.ts`                     |
| `public/`                               | `public/`                                   |
| tsconfig `"@/*": ["./*"]`               | `"@/*": ["./src/*"]`                        |

Farm writes `src/lib/api.generated.ts` once the app has API routes, so merge an existing `lib/`
folder into `src/lib` rather than nesting it.

## Replace Next.js modules

Rewrite these imports in every file, not only in `app/`. A shared component that still imports
`next/link` or `next/navigation` throws `invariant expected app router to be mounted`.

| Next.js            | Farm                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `next/link`        | `import { Link } from "@farm.js/core/client"`                           |
| `next/navigation`  | `@farm.js/core/navigation`                                              |
| `next/headers`     | `@farm.js/core/headers`                                                 |
| `next/cache`       | `@farm.js/core/cache`                                                   |
| `next/image`       | `import Image from "@farm.js/core/image"`                               |
| `next/font/local`  | `localFont` from `@farm.js/core/font`                                   |
| `next/font/google` | a font package with `localFont`, or `@fontsource*` CSS imports          |
| `next/script`      | the [scripts plugin](/docs/plugins/scripts) or a `<script>` in a layout |
| `next/dynamic`     | `React.lazy` with `<Suspense>`                                          |
| `next/og`          | `ImageResponse` from `@farm.js/core/og` (install `@vercel/og`)          |
| `next/server`      | standard `Request` and `Response`                                       |

Replace `next/font`, `next/image`, and `next/server` before the first run. `next/font/google` makes
every page fail in development, and a route handler that still imports `next/server` works in
development but crashes the production server at startup.

```tsx
import { Link } from "@farm.js/core/client";
import { cookies } from "@farm.js/core/headers";
import { redirect } from "@farm.js/core/navigation";

export default async function Page() {
  if (!(await cookies()).has("session")) redirect("/sign-in");
  return <Link href="/docs">Docs</Link>;
}
```

## Server actions

Farm supports two ways to run a mutation on the server.

| Approach               | Status       | Use it when                                                                 |
| ---------------------- | ------------ | --------------------------------------------------------------------------- |
| API routes as actions  | Stable       | Most apps. Each action becomes a typed endpoint.                            |
| Server functions (RSC) | Experimental | The app is built around `"use server"` actions and React Server Components. |

### API routes as actions

Move each action into a typed endpoint and call it through the generated client. React's form
hooks keep working with a client function as the action.

```ts
// src/app/api/todos/route.ts
import { createEndpoint } from "@farm.js/core/api";
import { revalidatePath } from "@farm.js/core/cache";
import { z } from "zod";

export const POST = createEndpoint(
  { body: z.object({ title: z.string().trim().min(1) }) },
  async ({ body }) => {
    const todo = await db.todo.create({ data: { title: body.title } });
    await revalidatePath("/todos");
    return todo;
  },
);
```

```tsx
"use client";
import { useActionState } from "react";
import { useRouter } from "@farm.js/core/navigation";
import { apiClient } from "@/lib/api";

export function TodoForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => {
      const { error } = await apiClient.todos.post({
        body: { title: String(formData.get("title") ?? "") },
      });
      if (error) return { error: error.message };
      router.refresh();
      return {};
    },
    {},
  );

  return (
    <form action={formAction}>
      <input name="title" />
      <button disabled={pending}>Add</button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
```

See [API Routes](/docs/api-routes) and [API Client](/docs/api-client) for validation, middleware,
and `src/lib/api.ts`.

### Server functions

Server functions are the closest match to Next.js server actions. A `"use server"` module ports
with only import changes, and `createServerFn` from `@farm.js/core/server-fn` adds input
validation, typed errors, and cache invalidation:

```ts
// src/actions/todos.ts
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

export const createTodo = createServerFn({
  input: z.object({ title: z.string().trim().min(1) }),
  async handler({ input }) {
    return db.todo.create({ data: { title: input.title } });
  },
});
```

Client components call it directly or through `useAction` from `@farm.js/core/client`, which also
works as a form action. This path runs on React Server Components through the
`@farm.js/plugin/rsc` Vite setup rather than `farm dev`, so it is experimental. Start from the
[`rsc-demo` example](https://github.com/farming-labs/farm.js/tree/main/examples/rsc-demo) and see
[Route actions](/docs/routing#route-actions) and
[Server action security](/docs/configuration#server-action-security).

Setting `experimental.serverActions` in `farm.config.ts` without that setup does not enable server
functions in the browser.

## Route handlers and middleware

Route handlers under `src/app/api` keep their exported HTTP methods. Replace `NextRequest` with
`Request` and `NextResponse.json()` with `Response.json()`.

Middleware moves to `src/app/middleware.ts`:

```ts
export function middleware(request: Request) {
  if (!request.headers.get("cookie")?.includes("session=")) {
    return Response.redirect(new URL("/sign-in", request.url), 307);
  }
}
```

Returning nothing continues the request, like `NextResponse.next()`. See
[Middleware](/docs/middleware) for matchers, rewrites, and request data.

## Behavior to review

- Pages are rendered on each request by default. Mark routes static explicitly where Next.js
  rendered them statically. See [Cache and PPR](/docs/cache-ppr).
- `params` is a plain object. `await params` keeps working, but `use(params)` does not.
- Page catch-all params such as `[...slug]` arrive as a single string joined with `/`.
- Public environment values are declared under `env` in `farm.config.ts` instead of relying on
  the `NEXT_PUBLIC_` prefix. See [Configuration](/docs/configuration).
- Tailwind CSS v4: run `pnpm add -D @tailwindcss/vite`, keep `tailwindcss` and
  `@import "tailwindcss";`, then delete `postcss.config.*`, `@tailwindcss/postcss`, and any Tailwind
  loader in `next.config`. Farm loads `@tailwindcss/vite` from the app; without it the build still
  succeeds but styles are not processed by Tailwind.
- Move `redirects`, `rewrites`, and `headers` from `next.config` into `farm.config.ts`. See
  [Configuration](/docs/configuration).
- Next's `LayoutProps` and `PageProps` globals do not exist in Farm. Import `LayoutProps` and
  `PageProps` from `@farm.js/core`; they take the same route literal, such as `PageProps<"/blog/[slug]">`.

## Finish the migration

```bash
pnpm dev
pnpm build
pnpm start
pnpm exec tsc --noEmit
```

Check every route in development and production, confirm client components hydrate and keep state
across client navigation, and exercise each action and API route. Remove `next`,
`eslint-config-next`, `next.config.*`, `next-env.d.ts`, and `.next/` only after the Farm build
behaves the same in production.
