# Better Auth Integration Example

This example uses the real `better-auth` package with:

- `src/lib/auth.ts` for the Better Auth server instance
- `src/lib/auth-client.ts` for the React client
- local SQLite storage via `better-sqlite3`
- `.env.example` for `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and optional social providers

Farm still handles the catch-all auth route internally, so there is no manual `src/app/api/auth/[...auth]/route.ts` file in the example.
