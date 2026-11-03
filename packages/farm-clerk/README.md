# @farm.js/clerk

Clerk authentication for Farm.js applications. The integration wraps the app in `ClerkProvider`
and can authenticate matched requests with Clerk's backend SDK before they reach a page. Clerk
keeps owning the UI, users, sessions, organizations, and account flows, so Farm creates no login,
callback, or session routes for it.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/clerk @clerk/react
```

`@clerk/react` and `react` are peer dependencies: Farm loads `ClerkProvider` from the app's own
`@clerk/react`. `@clerk/backend` is a dependency and installs with the package. Clerk's components
require the React renderer. To scaffold the registry entry and sign-in screens in an existing app,
run `farm add integration clerk --ui`.

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { clerk } from "@farm.js/clerk";

export default defineConfig({
  integrations: {
    auth: clerk({
      signInUrl: "/sign-in",
      signUpUrl: "/sign-up",
      protectedRoutes: ["/dashboard(.*)"],
    }),
  },
});
```

Keys come from the environment unless they are passed as `publishableKey` and `secretKey`:

| Variable                            | Purpose                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Publishable key, passed to `ClerkProvider`. Required.                           |
| `CLERK_PUBLISHABLE_KEY`             | Fallback name for the publishable key.                                          |
| `CLERK_SECRET_KEY`                  | Server key for request authentication. Required unless an `instance` is passed. |

Keep `CLERK_SECRET_KEY` in server-only environment variables, out of client code.

## Pages and components

`signInUrl` and `signUpUrl` tell Farm where the app's Clerk pages live. They do not create the
pages, so add them with Clerk's components:

```tsx
// src/app/sign-in/[...clerk]/page.tsx
"use client";

import { SignIn } from "@clerk/react";

export default function SignInPage() {
  return (
    <SignIn path="/sign-in" routing="path" signUpUrl="/sign-up" fallbackRedirectUrl="/dashboard" />
  );
}
```

Create the matching sign-up page with `SignUp`. Because Farm registers `ClerkProvider`, any client
component can use Clerk's hooks and components, such as `useUser`, `useAuth`, and `UserButton`,
without adding a provider of its own.

## Protected routes

For a request matching `protectedRoutes`, Farm calls `authenticateRequest` from `@clerk/backend`:

- an authenticated request continues to the page or API handler;
- Clerk handshake and cookie responses are forwarded as they are;
- a signed-out request gets a `307` redirect to `signInUrl`, with the original pathname in
  Clerk's `redirect_url`.

Clerk accepts the request origin as the only authorized party by default. List every trusted origin
when there are several:

```ts
clerk({
  authorizedParties: ["https://app.example.com", "https://admin.example.com"],
});
```

## Bring your own client

Pass a backend client through `instance` to keep Clerk construction in application code. The
secret key is then not required by Farm, but the publishable key still is, for `ClerkProvider`.

```ts
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@farm.js/clerk";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});

export const auth = clerk({
  instance: clerkClient,
  protectedRoutes: ["/dashboard(.*)"],
});
```

Without an instance, Farm creates one backend client lazily, on the first protected request.

## Options

| Option              | Default             | Notes                                              |
| ------------------- | ------------------- | -------------------------------------------------- |
| `instance`          |                     | Existing Clerk backend client.                     |
| `publishableKey`    | publishable key env |                                                    |
| `secretKey`         | `CLERK_SECRET_KEY`  | Not needed with `instance`.                        |
| `signInUrl`         | `/sign-in`          | App-owned sign-in page.                            |
| `signUpUrl`         | `/sign-up`          | App-owned sign-up page.                            |
| `protectedRoutes`   |                     | One matcher or a list.                             |
| `authorizedParties` | request origin      | Origins accepted by request authentication.        |
| `providerProps`     |                     | Extra `ClerkProvider` props, such as `appearance`. |
| `log`               |                     | Integration lifecycle logger.                      |

## Documentation

- [Clerk integration](https://farmjs.dev/docs/integrations/auth/clerk)
- [Auth integrations overview](https://farmjs.dev/docs/integrations/auth)

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
