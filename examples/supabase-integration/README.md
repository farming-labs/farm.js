# Supabase Integration Example

Config-only Supabase auth through `@farmjs/integrations/supabase`.

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

Create a small client once and reuse it in your custom pages:

```ts
import { createIntegrationClient } from "@farmjs/core/client";
import { supabaseClient } from "@farmjs/integrations/supabase/client";

export const api = createIntegrationClient({
  integrations: {
    supabase: supabaseClient,
  },
});
```

Client usage:

```ts
const { data, error } = await api.supabase.login({ body: ... });
```

Server usage:

```ts
const serverApi = createIntegrationClient(
  {
    integrations: {
      supabase: supabaseClient,
    },
  },
  {
    isServer: true,
    request,
  },
);

const { data, error } = await serverApi.supabase.session();
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
import { api } from "@farmjs/core/client";

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
import { api } from "@/lib/api";

export default function SignInPage() {
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const result = await api.supabase.login({
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

- `api.supabase.login({ body })`
- `api.supabase.signup({ body })`
- `api.supabase.oauth({ query })`
- `api.supabase.logout({ body })`
- `api.supabase.session()`

Each call resolves to:

```ts
{
  data: T | null;
  error: Error | null;
}
```
