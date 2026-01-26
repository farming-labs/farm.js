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
    about/
      page.tsx      # About page (/about)
    contact/
      page.tsx      # Contact page (/contact)
```

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
