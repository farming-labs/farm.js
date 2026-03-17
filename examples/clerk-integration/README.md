# Clerk Integration Example

This example uses the real Clerk SDK with:

- one `clerk({...})` integration entry in `farm.config.ts`
- a built-in `ClerkProvider` wrapper supplied by the Farm integration
- `@clerk/backend` for request authentication inside the Farm integration middleware
- a protected `/dashboard` route guarded by the integration

Place your Clerk keys in `.env.local` before starting the example. Farm loads env files automatically during config resolution.
