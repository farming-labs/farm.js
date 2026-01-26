# Farm.js Playground

This is a testing environment for the Farm.js framework. It demonstrates various features and provides a way to manually test the framework in a browser.

## Features Demonstrated

- **File-based Routing**: Next.js-style routing with `page.tsx` files
- **Dynamic Routes**: Pages with parameters like `[id]` and `[slug]`
- **Layouts**: Nested layouts with the root `layout.tsx`
- **TypeScript Support**: Full TypeScript integration
- **React Server Components**: Server-side rendering capabilities

## Pages Available

- `/` - Home page with feature overview
- `/about` - About page with framework information
- `/users` - Users listing page
- `/users/[id]` - Dynamic user profile pages (try `/users/123`)
- `/blog` - Blog listing page
- `/blog/[slug]` - Dynamic blog post pages (try `/blog/hello-world`)

## Running the Playground

```bash
# From the root of the monorepo
pnpm install
pnpm build

# Start the playground
cd playground
pnpm dev
```

The playground will be available at `http://localhost:3000`.

## Testing Checklist

When testing the playground, verify:

- [ ] All pages load without errors
- [ ] Navigation between pages works
- [ ] Dynamic routes resolve correctly
- [ ] Route parameters are passed properly
- [ ] Layout is applied consistently
- [ ] TypeScript compilation works
- [ ] Hot module replacement functions
- [ ] Server-side rendering works

## Notes

This playground is for development and testing purposes only. It helps verify that the Farm.js framework is working correctly and provides examples of how to structure a Farm.js application.
