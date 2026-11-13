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
} from "@farm.js/core/environment";
```

## Server-only functions

Use `createServerOnlyFn` for code that reads private environment variables, databases, the filesystem, or other server resources:

```ts
import { createServerOnlyFn } from "@farm.js/core/environment";
import { getEnv } from "@farm.js/core/env";

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
import { createClientOnlyFn } from "@farm.js/core/environment";

export const readTheme = createClientOnlyFn(() => {
  return localStorage.getItem("theme") ?? "system";
});
```

Calling `readTheme()` during SSR throws a descriptive environment mismatch instead of producing a vague `localStorage is not defined` error.

## Isomorphic functions

Use `createIsomorphicFn` when one operation needs different server and browser implementations:

```ts
import { createIsomorphicFn } from "@farm.js/core/environment";
import { getEnv } from "@farm.js/core/env";

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
- Prefer `@farm.js/core/environment` over the broad root entry when a module only needs these helpers.

## Client boundary diagnostics

Farm checks every application module it compiles for the browser and reports server-only access
with a stable code. A diagnostic names the code, the position in the source you wrote (mapped back
through TypeScript and JSX compilation), what is wrong, how to fix it, and a link to this section:

```txt
src/app/widget.tsx:11:16 - warning CLIENT_SERVER_ENV: process.env.DATABASE_URL is read at module scope in a module compiled for the browser, where it is undefined.
  fix: Read it on the server (a server function, API route, or server component), or declare it in env.public in farm.config.ts and read it through publicEnv.
  docs: https://farmjs.dev/docs/environment-functions#client-boundary-diagnostics
```

The first line follows the TypeScript diagnostic format, so editor and CI problem matchers can read
it, and a coding agent can act on the line alone. Warnings leave the build running; errors fail the build and the development request for the module.

| Code                        | Severity | Reported when                                                                                                                                                                                                                                              | Fix                                                                                                                                                                  |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLIENT_SERVER_ENV`         | warning  | A browser module reads a `process.env` key at module scope, directly or by destructuring `process.env`. It is `undefined` in the browser. `NODE_ENV` is exempt.                                                                                            | Read it on the server, or declare it in `env.public` and read it through `publicEnv`.                                                                                |
| `CLIENT_PROCESS_ENV_PUBLIC` | warning  | The key is declared in `env.public`, but the module reads it through `process.env`, which the browser does not populate.                                                                                                                                   | Read it through `publicEnv` from `@farm.js/core/env`.                                                                                                                |
| `CLIENT_NODE_BUILTIN`       | warning  | A browser module imports a Node builtin at module scope, as `node:fs` or as bare `fs`, and the browser gets Farm's stub, whose exports without a Web API equivalent are `undefined`. A browser package installed under the builtin's name is not reported. | Move the import into server-only code, or import it lazily inside a function that runs only on the server.                                                           |
| `CLIENT_SERVER_FUNCTION`    | error    | A module that calls `createServerFn` or `createServerQuery` is bundled into the browser without the server-function transform.                                                                                                                             | Add `@farm.js/plugin/rsc` and set `experimental.serverActions: true`, call the function from server code, or expose an API route and call it with `createAPIClient`. |
| `CLIENT_SERVER_ONLY_IMPORT` | error    | Client code reaches a module that imports `server-only`.                                                                                                                                                                                                   | Move what the client needs out of that module, or call it from a server component, server function, or API route.                                                    |

Reads and dynamic imports inside function bodies are not reported, because they may run only on
the server: a lazy `await import("node:fs")` behind a server check is the supported way to keep a
builtin out of the browser's module scope.
