# Farm Auth Example

This example uses Farm-native authentication with:

- `auth: true` in `farm.config.ts`
- email/password sign-up and sign-in enabled by default
- `@farm.js/auth/client` for browser functions and the `useAuth` hook
- `@farm.js/auth/server` for request-scoped `auth.session()` and `auth.user()`
- lazy local SQLite storage without database work during config loading

There is no app-local auth instance or manual `src/app/api/auth/[...auth]/route.ts`.

For production, set `DATABASE_URL`, `FARM_AUTH_SECRET`, and `FARM_AUTH_URL`, then run:

```bash
pnpm auth:migrate
```
