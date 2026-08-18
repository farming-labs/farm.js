---
title: "Clerk Integration"
description: "Register ClerkProvider and protect Farm routes with Clerk request authentication."
section: "Integrations"
---

# Clerk Integration

The Clerk integration connects Clerk's React and backend SDKs to the Farm runtime. Farm wraps the app in `ClerkProvider` and can authenticate matched requests, while Clerk remains responsible for UI, users, sessions, organizations, and account flows.

Farm does not create Clerk login, callback, session, or logout API routes.

## Add Clerk

**Terminal**

```bash
farm add integration clerk --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { clerk } from "@farm.js/clerk";

export const appIntegrations = {
  auth: clerk({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
    protectedRoutes: ["/dashboard(.*)"],
  }),
} as const;
```

The keys can be omitted from the call when the environment variables are set.

## Environment variables

| Variable                            | Required    | Purpose                                            |
| ----------------------------------- | ----------- | -------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes         | Preferred publishable key name.                    |
| `CLERK_PUBLISHABLE_KEY`             | Alternative | Fallback environment name for the publishable key. |
| `CLERK_SECRET_KEY`                  | Yes         | Used by `@clerk/backend` to authenticate requests. |

Install `@clerk/react` and `@clerk/backend` in the application. Farm loads the React provider at render time and the backend client inside protected-route middleware.

## Choose SDK ownership

### Let Farm construct Clerk

The configuration above is the default path. When `instance` is omitted, Farm lazily creates one
Clerk backend client from `publishableKey` and `secretKey`. Both values may be passed directly or
read from the documented environment variables.

### Provide an application-owned instance

Pass a backend client through `instance` to keep Clerk construction and version-specific options in
application code. The publishable key is still required for `ClerkProvider`; the secret key is not
required by Farm when the backend instance is supplied.

When both an instance and construction credentials are present, the instance wins. Farm-owned
options such as `protectedRoutes`, `providerProps`, and sign-in URLs stay beside `instance` in the
declarative integration object.

```ts
import { defineConfig } from "@farm.js/core";
import { createClerkClient } from "@clerk/backend";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});

export default defineConfig({
  integrations: {
    auth: {
      provider: "clerk",
      instance: clerkClient,
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      protectedRoutes: ["/dashboard(.*)"],
    },
  },
});
```

Farm loads the installed `@farm.js/clerk` adapter from `provider`; application code does not import
or call `clerk(...)` for this path.

## Create sign-in and sign-up pages

`signInUrl` and `signUpUrl` tell Farm where your Clerk pages live. They do not create those pages.

**src/app/sign-in/[...clerk]/page.tsx**

```tsx
"use client";

import { SignIn } from "@clerk/react";

export default function SignInPage() {
  return (
    <SignIn path="/sign-in" routing="path" signUpUrl="/sign-up" fallbackRedirectUrl="/dashboard" />
  );
}
```

Create the matching sign-up page with Clerk's `SignUp` component.

## Use Clerk in the app

Because Farm registers `ClerkProvider`, client components can use Clerk directly:

```tsx
"use client";

import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/react";

export function AccountMenu() {
  return (
    <>
      <SignedOut>
        <SignInButton />
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </>
  );
}
```

Use Clerk's hooks and backend APIs for session, user, and organization data. There is no `api.auth.session` operation for this integration.

## Protect app routes

```ts
clerk({
  signInUrl: "/sign-in",
  protectedRoutes: ["/dashboard(.*)", "/settings(.*)"],
});
```

For a matched request, Farm calls `authenticateRequest` from `@clerk/backend`:

- authenticated requests continue to the page or API handler;
- Clerk handshake and cookie responses are forwarded;
- signed-out requests receive a `307` redirect to `signInUrl`;
- the original pathname is sent as Clerk's `redirect_url`.

## Authorized parties

By default, Clerk accepts the current request origin as an authorized party. Set an explicit list when the app has multiple trusted origins:

```ts
clerk({
  authorizedParties: ["https://app.example.com", "https://admin.example.com"],
});
```

This is especially useful when protecting against cookie misuse across sibling domains.

## Provider props

Pass additional `ClerkProvider` props through `providerProps`:

```ts
clerk({
  providerProps: {
    appearance: {
      variables: {
        colorPrimary: "#111111",
      },
    },
  },
});
```

`publishableKey` is supplied automatically and can still be combined with these props.

## Options

| Option              | Default                   | Use                                               |
| ------------------- | ------------------------- | ------------------------------------------------- |
| `instance`          | None                      | Existing Clerk backend client.                    |
| `publishableKey`    | Clerk publishable key env | Client-safe Clerk key.                            |
| `secretKey`         | `CLERK_SECRET_KEY`        | Server Clerk key when no instance is supplied.    |
| `signInUrl`         | `/sign-in`                | App-owned Clerk sign-in page.                     |
| `signUpUrl`         | `/sign-up`                | App-owned Clerk sign-up page.                     |
| `protectedRoutes`   | None                      | One matcher or a list of matchers.                |
| `authorizedParties` | Current origin            | Origins accepted by Clerk request authentication. |
| `providerProps`     | `{}`                      | Additional props for `ClerkProvider`.             |

## Production checklist

- Keep `CLERK_SECRET_KEY` out of client code.
- Configure Clerk's allowed origins and redirect URLs.
- Create both sign-in and sign-up catch-all pages.
- Test Clerk handshake redirects as well as normal signed-out redirects.
- Verify organization switching on every tenant-scoped route.
