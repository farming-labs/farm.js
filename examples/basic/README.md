# Farm.js Basic Example

This is a basic example demonstrating the core features of Farm.js without any complex dependencies or configurations.

## Features Demonstrated

- ✅ File-based routing
- ✅ React Server Components
- ✅ TypeScript support
- ✅ Zero configuration setup
- ✅ Vite-powered development
- ✅ Layouts and nested routing

## Running the Example

```bash
# From the root of the monorepo
pnpm install
pnpm build

# Start the example
cd examples/basic
pnpm dev
```

The example will be available at `http://localhost:3000`.

## Project Structure

```
src/
  app/
    layout.tsx      # Root layout with navigation
    page.tsx        # Home page (/)
    error.tsx       # Route-level error boundary (catches errors for this segment)
    loading.tsx     # Route-level loading UI (Suspense fallback while segment loads)
    about/
      page.tsx      # About page (/about)
    contact/
      page.tsx      # Contact page (/contact)
```

## Route-level boundaries (Next.js-style)

- **`error.tsx`** – Catches runtime errors during SSR or client render for that route segment. Receives `error` and `reset()`. When an error is thrown (e.g. in a page or async component), this UI is shown instead; "Try again" calls `reset()` to re-render.
- **`loading.tsx`** – Shown while the route segment is loading (e.g. async page/layout, streaming). Wraps the segment in a Suspense boundary; you get instant loading states during navigation and SSR streaming.

## What to Explore

1. **File-based Routing**: Notice how each `page.tsx` file creates a new route
2. **Layouts**: The root layout provides consistent navigation across all pages
3. **TypeScript**: Full type safety with `PageProps` and other Farm.js types
4. **Zero Config**: No complex configuration needed - just start coding!

## Next Steps

After exploring this basic example, check out:

- [With Database Example](../with-database) - Shows data fetching and database integration
- [E-commerce Example](../e-commerce) - A full-featured e-commerce application
- [Documentation](../../docs) - Complete Farm.js documentation

