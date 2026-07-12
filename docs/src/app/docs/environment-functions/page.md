---
title: "Environment Functions"
description: "Keep server-only and client-only implementations out of the wrong Farm bundle."
section: "Core"
---

# Environment Functions

Environment functions make runtime boundaries explicit while keeping one typed function interface. Farm selects the correct implementation during compilation and removes the opposite implementation from the generated module.

Import them from the focused environment entry:

```ts
import {
  createClientOnlyFn,
  createIsomorphicFn,
  createServerOnlyFn,
} from "@farmjs/core/environment";
```

## Server-only functions

Use `createServerOnlyFn` for code that reads private environment variables, databases, the filesystem, or other server resources:

```ts
import { createServerOnlyFn } from "@farmjs/core/environment";
import { getEnv } from "@farmjs/core/env";

export const readDatabaseUrl = createServerOnlyFn(() => {
  return getEnv("DATABASE_URL");
});
```

The server build contains the implementation. The client build contains a small function that throws `FarmEnvironmentError` when called; the `DATABASE_URL` implementation is not emitted.

Arguments and return values keep their original types:

```ts
export const findInvoice = createServerOnlyFn(async (invoiceId: string) => {
  return db.invoice.findUnique({ where: { id: invoiceId } });
});
```

## Client-only functions

Use `createClientOnlyFn` around browser APIs that cannot run during SSR:

```ts
import { createClientOnlyFn } from "@farmjs/core/environment";

export const readTheme = createClientOnlyFn(() => {
  return localStorage.getItem("theme") ?? "system";
});
```

Calling `readTheme()` during SSR throws a descriptive environment mismatch instead of producing a vague `localStorage is not defined` error.

## Isomorphic functions

Use `createIsomorphicFn` when one operation needs different server and browser implementations:

```ts
import { createIsomorphicFn } from "@farmjs/core/environment";
import { getEnv } from "@farmjs/core/env";

export const getApplicationOrigin = createIsomorphicFn({
  server: () => getEnv("APP_ORIGIN"),
  client: () => window.location.origin,
});
```

Farm emits only `server` in server and RSC bundles, and only `client` in browser bundles. Both implementations must accept compatible arguments. If their return types differ, the callable result uses their return-type union.

The options object must be inline so Farm can statically select a property:

```ts
// Supported
const formatPath = createIsomorphicFn({
  server: serverFormat,
  client: clientFormat,
});

// Not supported because the compiler cannot inspect the object safely
const implementations = { server: serverFormat, client: clientFormat };
const dynamicFormatPath = createIsomorphicFn(implementations);
```

## Build behavior

| Build target | `createServerOnlyFn` | `createClientOnlyFn` | `createIsomorphicFn` |
| ------------ | -------------------- | -------------------- | -------------------- |
| Server / SSR | Keeps implementation | Emits throwing stub  | Keeps `server`       |
| RSC          | Keeps implementation | Emits throwing stub  | Keeps `server`       |
| Browser      | Emits throwing stub  | Keeps implementation | Keeps `client`       |

Farm applies the same transform in development, production, static client builds, SSR, and the RSC pipeline. Outside the Farm compiler, the helpers fall back to runtime environment detection and still throw on invalid calls, but compile-time code removal requires a Farm build.

## Security guidance

- Keep sensitive implementations inline when possible. This gives the compiler the strongest guarantee that the entire opposite-side body is removed.
- Imported implementation modules should be free of top-level side effects. JavaScript imports execute before a function is created, so wrapping a function does not sandbox its module.
- Never return a secret from a server-only function to client code. The implementation boundary protects source code and dependencies, not values that your application deliberately serializes.
- Treat environment functions as bundle boundaries, not authorization. Server functions and API routes still need authentication and authorization.
- Prefer `@farmjs/core/environment` over the broad root entry when a module only needs these helpers.
