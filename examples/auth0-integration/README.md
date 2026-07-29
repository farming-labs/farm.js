# Auth0 Integration Example

Config-only Auth0 setup through `@farm.js/auth0`.

The example passes the callback URL directly in `farm.config.ts`:

```ts
auth0({
  callbackUrl: "http://localhost:3000/auth/callback",
  protectedRoutes: ["/dashboard(.*)"],
})
```

Getting started:

1. Add an `.env.local` in this example with:
   - `AUTH0_DOMAIN`
   - `AUTH0_CLIENT_ID`
   - `AUTH0_CLIENT_SECRET`
   - `AUTH0_SECRET`
2. In Auth0, allow:
   - callback URL: `http://localhost:3000/auth/callback`
   - logout URL: `http://localhost:3000`
3. Run `pnpm dev`

The integration owns:

- `/auth/login`
- `/auth/signup`
- `/auth/callback`
- `/auth/logout`
- `/auth/profile`

The example also exposes shared callers in [api.ts](/Users/mac/oss/farm.js/examples/auth0-integration/src/lib/api.ts):

- `api` for server-side calls that dispatch directly to the registered integration handler
- `apiClient` for browser calls that go through the integration-owned routes

Examples:

- home page: `apiClient.auth.profile()` and `apiClient.auth.logout()`
- dashboard page: `api.auth.profile()`
