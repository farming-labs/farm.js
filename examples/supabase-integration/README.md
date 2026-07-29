# Supabase Integration Example

Config-only Supabase auth through `@farm.js/supabase`.

The example uses:

```ts
supabase({
  callbackUrl: "http://localhost:3000/auth/callback",
  protectedRoutes: ["/dashboard(.*)"],
})
```

If you want your own auth screens, point the integration at your routes and use the generated client API:

```ts
supabase({
  callbackUrl: "http://localhost:3000/auth/callback",
  protectedRoutes: ["/dashboard(.*)"],
  pages: {
    signIn: "/sign-in",
    signUp: "/sign-up",
  },
})
```

Getting started:

1. Add an `.env.local` in this example with:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
   - `APP_BASE_URL=http://localhost:3000`
2. If you enable social providers later, use this callback URL in Supabase:
   - `http://localhost:3000/auth/callback`
3. Run `pnpm dev`

The integration owns:

- `/auth/login`
- `/auth/signup`
- `/auth/callback`
- `/auth/logout`
- `/auth/session`

Create the shared callers once and reuse them in your pages:

```ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./src/lib/integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
```

Client usage:

```ts
const { data, error } = await apiClient.auth.login.post({ body: ... });
```

Server usage:

```ts
const { data, error } = await api.auth.session.get();
```

There is also a live SSR example in:

- `src/app/server-demo/page.tsx`

It uses:

```ts
const result = await api.localDemo.message.get();
```

This example also includes an app-local integration to show that integrations are not limited to
the ones published by Farm:

```ts
import { localDemo } from "./src/lib/integrations/local-demo/index.ts";

export default defineConfig({
  integrations: {
    auth: supabase(...),
    localDemo: localDemo(),
  },
});
```

The local integration definition lives in:

- `src/lib/integrations/local-demo/index.ts`

Farm infers its client and server callers from the registered integration routes, so it is used
through the same shared client without a separate `client.ts` file:

```ts
const { data, error } = await apiClient.localDemo.message.get();
const echo = await apiClient.localDemo.message.post({
  body: {
    message: "hello from a local integration",
  },
});
```

Server-only methods should be registered on the integration definition itself:

```ts
export const myIntegrationClient = {
  login: api.post<LoginBody, LoginResult>("/auth/login"),
  session: api.get<SessionResult>("/auth/session", {
    responseFormat: "json",
    isServer: true,
  }),
};
```

That works for any integration namespace, not just auth.

For integration authors, the intended shape is now just a plain endpoint namespace:

```ts
import { api } from "@farm.js/core/client";

export const myIntegrationClient = {
  login: api.post<LoginBody, LoginResult>("/auth/login"),
  session: api.get<SessionResult>("/auth/session", {
    responseFormat: "json",
    isServer: true,
  }),
};
```

Then call the inferred methods directly:

```tsx
"use client";

import { useState } from "react";
import { apiClient } from "@/lib/api";

export default function SignInPage() {
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const result = await apiClient.supabase.login({
      body: {
        email: String(formData.get("email") || ""),
        password: String(formData.get("password") || ""),
        returnTo: "/dashboard",
      },
    });

    if (result.error) {
      setPending(false);
      return;
    }

    if (result.data) {
      window.location.assign(result.data.redirectTo);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" required />
      <input type="password" required />
      <button disabled={pending} type="submit">
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
```

The available typed methods are:

- `apiClient.supabase.login({ body })`
- `apiClient.supabase.signup({ body })`
- `apiClient.supabase.oauth({ query })`
- `apiClient.supabase.logout({ body })`
- `apiClient.supabase.session()`

Each call resolves to:

```ts
{
  data: T | null;
  error: Error | null;
}
```
