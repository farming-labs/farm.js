<p align="center">
  <a href="https://farmjs.dev">
    <img src="./.github/assets/farmjs-lockup.svg" alt="Farm.js" width="420" />
  </a>
</p>

<p align="center">
  <strong>A framework for building fast, full-stack, product-integrated applications.</strong>
</p>

<p align="center">
  Farm.js combines Vite's instant development experience with typed app-directory routing, secure Server Actions, streaming SSR, and production-ready deployment output. React is the default renderer, with first-class Preact, Solid, Vue, and Svelte support behind the same routing and server contracts.
</p>

<p align="center">
  <a href="https://farmjs.dev"><strong>Documentation</strong></a>
  ·
  <a href="./examples"><strong>Examples</strong></a>
  ·
  <a href="#-quick-start"><strong>Quick Start</strong></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@farm.js/core"><img src="https://img.shields.io/npm/v/%40farm.js%2Fcore?label=%40farm.js%2Fcore&color=black" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Ready-blue.svg" alt="TypeScript ready" /></a>
</p>

<p align="center">
  <a href="https://stackblitz.com/github/farming-labs/farm.js/tree/main/examples/stackblitz?file=src%2Fapp%2Fpage.tsx&title=Farm.js%20Playground"><img src="https://developer.stackblitz.com/img/open_in_stackblitz.svg" alt="Open in StackBlitz" /></a>
</p>

## ✨ Built for Full-Stack Products

| Feature                            | What it gives you                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⚛️ **Custom RSC renderer**         | A purpose-built RSC, streaming SSR, and client hydration pipeline, with optional Rust-native rendering for eligible host-only regions through [Strata](https://github.com/farming-labs/strata).                                                            |
| 🔄 **Server Actions**              | Write mutations next to your components with `"use server"`, form actions, optional encrypted bound arguments, and configurable request security.                                                                                                          |
| ⚡ **Blazingly fast development**  | Vite-powered startup, on-demand transforms, and fast HMR keep the feedback loop nearly instant.                                                                                                                                                            |
| 🧭 **Typed app-directory routing** | Pages, layouts, route groups, dynamic segments, loading states, error boundaries, middleware, and generated route types.                                                                                                                                   |
| 🧩 **Flexible rendering**          | Choose streaming SSR, static generation, ISR, PPR, or deferred hydration islands route by route.                                                                                                                                                           |
| 🛠️ **Full-stack primitives**       | Build with API routes, server functions, middleware, caching, KV storage, cron handlers, OpenAPI, and post-response work.                                                                                                                                  |
| 🔌 **First-party integrations**    | Add authentication, billing, email, jobs, AI, API keys, databases, and provider-owned routes through one typed integration model.                                                                                                                          |
| 🎭 **Renderer choice**             | React by default, with Preact, Solid, Vue, and Svelte renderers selected by one line of config — same routes, server functions, and integrations everywhere.                                                                                               |
| 🧪 **AOT React compiler**          | An experimental compiler turns eligible components into direct DOM updates that skip reconciliation (~6.8x faster keyed swaps, ~2x less CPU in the [benchmark](./benchmarks/compiler)), falling back to normal React whenever eligibility can't be proven. |
| 🚀 **Production-ready output**     | Build deployable server and client output with Nitro-powered adapters and per-route runtime controls.                                                                                                                                                      |
| 🎨 **Great defaults**              | Start with TypeScript, Tailwind CSS, sensible conventions, and a clean project structure—without assembling the framework yourself.                                                                                                                        |

> **Experimental native rendering:** Farm.js can automatically send eligible, server-only React subtrees through the [Strata](https://github.com/farming-labs/strata) native renderer while safely falling back to normal React rendering for unsupported trees.

## 🚀 Quick Start

### Try It in Your Browser

No install needed: [open the playground on StackBlitz](https://stackblitz.com/github/farming-labs/farm.js/tree/main/examples/stackblitz?file=src%2Fapp%2Fpage.tsx&title=Farm.js%20Playground) to see server rendering, client islands, and typed server calls in one page.

### Create a New App

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-app --template basic --typescript
cd my-app
pnpm dev
```

Your app will be running at `http://localhost:3000`!

Use `--list-templates` to choose a ready-to-configure Auth0, Auth.js, Autumn, Clerk, Inngest,
Trigger.dev, Polar, Resend, Stripe, Supabase, Unkey, WorkOS, or AI starter.

### Manual Installation

```bash
npm install @farm.js/core@beta react react-dom
# or
pnpm add @farm.js/core@beta react react-dom
# or
yarn add @farm.js/core@beta react react-dom
```

Create a `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  deploy: {
    target: "vercel",
  },
});
```

Farm uses `src` as the source directory by default. Add `srcDir` only when your app uses a
different directory.

`defineFarmConfig` remains available as a deprecated exact alias of `defineConfig`.

Create your first page in `src/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <h1 className="text-5xl font-bold text-blue-600">Hello from Farm.js!</h1>
    </div>
  );
}
```

> 💡 **Tailwind CSS is pre-configured!** Just use Tailwind classes - no setup needed. See [TAILWIND_SETUP.md](./TAILWIND_SETUP.md) for details.

Add a root layout in `src/app/layout.tsx`:

```tsx
import type { LayoutProps } from "@farm.js/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
```

Start the development server:

```bash
npx farm dev
```

## 📁 Project Structure

```
my-farm-app/
├── src/
│   └── app/
│       ├── layout.tsx          # Root layout
│       ├── page.tsx            # Home page (/)
│       ├── about/
│       │   └── page.tsx        # About page (/about)
│       └── users/
│           ├── page.tsx        # Users list (/users)
│           └── [id]/
│               └── page.tsx    # User profile (/users/123)
├── farm.config.ts
└── package.json
```

## ⚙️ Configuration

Farm.js supports a powerful configuration system via `farm.config.ts`:

```typescript
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },

  // Routing
  async redirects() {
    return [{ source: "/old", destination: "/new", permanent: true }];
  },

  // Custom headers
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },

  // Environment variables
  env: {
    API_URL: "https://api.example.com",
  },

  // Plugins
  plugins: [
    /* your plugins */
  ],

  // And much more...
});
```

See [farm.config.ts documentation](./PLUGIN_SYSTEM.md) for all options.

### Route-level Boundaries

Farm.js supports Next.js-style route boundaries with special files inside a route segment:

- `loading.tsx` - Route-level loading UI shown while the segment is suspended
- `error.tsx` - Route-level error UI shown when the segment throws during render

Example structure:

```text
src/app/
  layout.tsx
  page.tsx
  loading.tsx
  error.tsx
  dashboard/
    page.tsx
    loading.tsx
    error.tsx
```

Required config:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
});
```

How it works:

- `loading.tsx` is used automatically as the Suspense fallback for that segment
- `error.tsx` is used automatically as the error boundary for that segment
- You do not need to import or conditionally render `loading.tsx` in `page.tsx`
- The route must actually suspend to show `loading.tsx` (for example: async server component, async layout, or a child wrapped by Suspense)
- `loading.tsx` and `error.tsx` do not need `'use client'` unless they use client-only features like hooks or browser APIs

Example:

```tsx
// src/app/dashboard/loading.tsx
export default function Loading() {
  return <p>Loading dashboard...</p>;
}
```

```tsx
// src/app/dashboard/page.tsx
async function SlowContent() {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return <div>Dashboard ready</div>;
}

export default function DashboardPage() {
  return <SlowContent />;
}
```

## 🔌 Plugin System

Extend Farm.js with powerful plugins:

```typescript
import { definePlugin } from "@farm.js/core";

export const myPlugin = definePlugin({
  name: "my-plugin",

  async beforeRequest(req, res, context) {
    // Add custom logic before request processing
  },

  async transformHTML(html, context) {
    // Modify HTML output
    return html;
  },
});
```

See [Plugin System Guide](./PLUGIN_SYSTEM.md) for comprehensive documentation.

## 🎯 Core Concepts

### File-based Routing

Farm.js uses Next.js App Router-style file-based routing:

- `page.tsx` - Creates a route
- `layout.tsx` - Shared UI for a route segment
- `[param]/` - Dynamic route segment
- `[...slug]/` - Catch-all route segment

### React Server Components

Server Components run on the server and can directly access databases, file systems, or other server-only resources:

```tsx
// This runs on the server
export default async function BlogPost({ params }: { params: { slug: string } }) {
  const post = await getPostFromDatabase(params.slug);

  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  );
}
```

### Client Components

Use the `'use client'` directive for interactive components:

```tsx
"use client";

import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);

  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
```

## 📚 Documentation

Visit [farmjs.dev](https://farmjs.dev) for comprehensive documentation, guides, and API reference.

## 🏗️ Development

### Prerequisites

- Node.js 18+
- pnpm 8+

### Setup

```bash
git clone https://github.com/farming-labs/farm.js.git
cd farm.js
./scripts/setup.sh
```

### Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (from root: runs tests in all packages; @farm.js/core runs Vitest)
pnpm test

# Run only @farm.js/core tests
pnpm run test:farm

# Run tests and save output to test-run.log
pnpm run test:ci
# then: cat test-run.log

# Start playground
cd playground && pnpm dev

# Start documentation
cd docs && pnpm dev

# Run example
cd examples/basic && pnpm dev
```

### Project Structure

```
farm.js/
├── packages/
│   ├── farm/              # Core framework
│   ├── farm-cli/          # @farm.js/cli tools
│   ├── create-farm-app/   # App creation tool
│   ├── farm-react/        # React renderer + AOT compiler
│   └── farm-{preact,solid,vue,svelte}/  # Other renderers
├── examples/
│   ├── basic/             # Basic example
│   ├── rsc-demo/          # Server components, actions, and queries
│   └── stripe-integration/ # Typed integration usage
├── docs/                  # Documentation (Farm.js)
├── playground/            # Development testing
└── tests/                 # Integration tests
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Quick Contribution Steps

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Push and create a Pull Request

## 🌟 Examples

- **[Basic Example](./examples/basic)** - Routing, boundaries, middleware, storage, and rendering modes in one app
- **[RSC Demo](./examples/rsc-demo)** - Server components, server actions, and server queries
- **[React Compiler](./examples/react-compiler)** - The experimental AOT compiler side by side with baseline React
- **[Stripe Integration](./examples/stripe-integration)** - Typed billing integration with provider-owned routes
- **[Solid Renderer](./examples/solid-renderer)** - A Solid app on the same framework contracts
- **[Preact Renderer](./examples/preact-renderer)** - A Preact app on the same framework contracts
- **[Vue Renderer](./examples/vue-renderer)** - A Vue app on the same framework contracts
- **[Svelte Renderer](./examples/svelte-renderer)** - A Svelte app on the same framework contracts

## 🔗 Ecosystem

- **[Vite](https://vitejs.dev/)** - Build tool and development server
- **[React](https://react.dev/)** - UI library with Server Components
- **[TypeScript](https://www.typescriptlang.org/)** - Type safety and developer experience

## 📄 License

MIT © [Farming Labs](https://github.com/farming-labs)

## 🙏 Acknowledgments

Farm.js is inspired by:

- **[Next.js](https://nextjs.org/)** - For the excellent App Router API design
- **[Vite](https://vitejs.dev/)** - For the incredible development experience
- **[@lazarv/react-server](https://github.com/lazarv/react-server)** - For RSC implementation insights
- **[Remix](https://remix.run/)** - For web-first development principles

---

<div align="center">

**[Documentation](https://farmjs.dev)** • **[Examples](./examples)** • **[Contributing](CONTRIBUTING.md)**

Made with ❤️ by&ensp;<a href="https://www.farming-labs.dev"><img src="./.github/assets/farming-labs-mark.svg" alt="" height="18" align="center" />&nbsp;Farming Labs</a> team

</div>
