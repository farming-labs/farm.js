---
title: "Clerk Integration"
description: "Use Clerk sessions, protected routes, and provider wrappers through Farm."
section: "Integrations"
---

# Clerk Integration

Clerk is the hosted auth path for projects that want prebuilt account UI, organizations, and SDK-backed session helpers while keeping Farm route conventions.

## Add Clerk

**Terminal**

```bash
farm add integration clerk --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { clerk } from "@farmjs/integrations/auth";

export const integrations = {
  auth: clerk({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  }),
};
```

## Use it

**Client UI**

```tsx
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/react";

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

Clerk remains the source of truth for users, sessions, organizations, and hosted account UI. Farm registers the provider metadata and middleware behavior so protected routes and integration discovery stay in one place.

## What Clerk adds

The Clerk integration contributes provider metadata for a Clerk provider wrapper and optional protected route middleware. Clerk remains the source of truth for session state, users, organizations, and hosted account UI.

## Protected routes

```ts
clerk({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
  protectedRoutes: ["/dashboard(.*)", "/api/private/[...path]"],
  signInUrl: "/sign-in",
  signUpUrl: "/sign-up",
});
```

## App usage

Use Clerk UI and hooks in the client, and keep server-sensitive reads on the server. Farm's role is to register provider metadata, protect matched routes, and keep the auth integration visible alongside other app integrations.

## Production notes

- Set `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY`.
- Keep the secret key out of browser code.
- Configure sign-in and sign-up URLs consistently in Clerk and Farm.
- Test signed-out protected routes, signed-in dashboard routes, and organization switching if enabled.
