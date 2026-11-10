# @farm.js/authjs

Auth.js route mounting for Farm.js applications. Pass an application-owned Auth.js object and Farm
mounts its `GET` and `POST` handlers at `/api/auth/[...nextauth]`. Auth.js keeps owning providers,
callbacks, cookies, and sessions; Farm does not reimplement any of it.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/authjs @auth/core
```

This package has no Auth.js dependency of its own. The application installs Auth.js and the
provider packages it uses. `farm add integration authjs --ui` adds `@auth/core`, writes a GitHub
OAuth instance to `src/lib/auth.ts`, and registers it.

## Create the Auth.js instance

The adapter needs one thing from the instance: a `handlers` object with `GET` and `POST` functions
that take a `Request` and return a `Response`. With `@auth/core`:

```ts
// src/lib/auth.ts
import { Auth } from "@auth/core";
import GitHub from "@auth/core/providers/github";

const config = {
  // Auth.js parses actions relative to this path, so it matches the route Farm mounts.
  basePath: "/api/auth",
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
  ],
  secret: process.env.AUTH_SECRET,
  trustHost: true,
};

const handler = (request: Request) => Auth(request, config);

export const auth = {
  handlers: {
    GET: handler,
    POST: handler,
  },
};
```

The object returned by `NextAuth(...)` also has this shape and can be passed directly.

## Register it

```ts
import { defineConfig } from "@farm.js/core";
import { authjs } from "@farm.js/authjs";
import { auth } from "./src/lib/auth";

export default defineConfig({
  integrations: {
    auth: authjs({
      instance: auth,
    }),
  },
});
```

Farm mounts one catch-all route:

```text
GET  /api/auth/[...nextauth]
POST /api/auth/[...nextauth]
```

Requests such as `/api/auth/session`, `/api/auth/signin`, and `/api/auth/callback/<provider>` reach
that route and are delegated to Auth.js. Register provider callback URLs under
`/api/auth/callback/<provider>`.

| Request                         | Behavior                               |
| ------------------------------- | -------------------------------------- |
| `GET` under the catch-all path  | Delegated to `instance.handlers.GET`.  |
| `POST` under the catch-all path | Delegated to `instance.handlers.POST`. |
| Method with no matching handler | `405 Method Not Allowed` with `Allow`. |

## Sessions and protection

There is no generated `api.auth` caller for this integration and no `protectedRoutes` option. Read
the session through Auth.js. In the browser, its own endpoint works:

```ts
const response = await fetch("/api/auth/session", { credentials: "include" });
const session = await response.json();
```

Protect pages with your Auth.js setup or with [Farm middleware](https://farmjs.dev/docs/middleware)
that checks the session, then apply the app's own authorization rules to each resource.

## Options

| Option     | Required | Notes                                           |
| ---------- | -------- | ----------------------------------------------- |
| `instance` | Yes      | Object with `handlers.GET` and `handlers.POST`. |
| `log`      | No       | Integration lifecycle and route logger.         |

Provider credentials, adapters, callbacks, events, and session settings all belong in the Auth.js
configuration. `AUTH_SECRET` and every provider credential must be set in production.

Use only one auth owner per app: either this integration or top-level Farm Auth (`auth: true`),
which ships as [`@farm.js/auth`](https://www.npmjs.com/package/@farm.js/auth) and needs no
provider setup.

## Documentation

- [Auth.js integration](https://farmjs.dev/docs/integrations/auth/authjs)
- [Auth integrations overview](https://farmjs.dev/docs/integrations/auth)

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
