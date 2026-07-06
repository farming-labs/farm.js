---
title: "Auth.js Integration"
description: "Mount Auth.js routes and session helpers through Farm's integration API."
section: "Integrations"
---

# Auth.js Integration

Auth.js works well when a project already uses NextAuth-style providers and callbacks but wants Farm to own routing, typed callers, and middleware wiring.

## Add Auth.js

**Terminal**

```bash
farm add integration authjs --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { authjs } from "@farmjs/integrations/auth";

export const integrations = {
  auth: authjs({
    secret: process.env.AUTH_SECRET,
    providers: [],
  }),
};
```

## Use it

**Mounted route**

```ts
const response = await fetch("/api/auth/session", {
  credentials: "include",
});

const session = await response.json();
```

Farm mounts the Auth.js handler at the provider route. Use Auth.js helpers such as `auth()` on the server and the provider client helpers in the browser when you need Auth.js-native session behavior.

## What Auth.js adds

Auth.js is mounted at `/api/auth/[...nextauth]` with `GET` and `POST` handlers. Farm delegates to the `handlers` object created by Auth.js while keeping the integration registered in `farm.config.ts`.

## Full app shape

**src/lib/auth.ts**

```ts
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth } = NextAuth({
  providers: [GitHub],
});
```

**src/lib/integrations.ts**

```ts
import { authjs } from "@farmjs/integrations/auth";
import { handlers } from "./auth";

export const integrations = {
  auth: authjs({
    instance: {
      handlers,
    },
  }),
};
```

## Production notes

- Set `AUTH_SECRET` and provider credentials.
- Configure provider callback URLs to match the Farm route.
- Use Auth.js callbacks for provider-specific account logic.
- Use Farm route middleware for app-specific page/API protection.
- Test both `GET` and `POST` auth handler paths.
