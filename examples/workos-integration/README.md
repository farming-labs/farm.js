# WorkOS Integration Example

This example uses the real WorkOS AuthKit flow with:

- one `workos({...})` integration entry in `farm.config.ts`
- integration-owned `/login`, `/signup`, `/callback`, `/logout`, and `/auth/session` routes
- cookie-backed protected route handling for `/dashboard`
- no app-local auth wrapper code

Create a `.env.local` file with:

```sh
WORKOS_CLIENT_ID=client_...
WORKOS_API_KEY=sk_test_...
```

Farm loads env files automatically during config resolution. In development, the integration falls back to a local cookie password if `WORKOS_COOKIE_PASSWORD` is not set.
