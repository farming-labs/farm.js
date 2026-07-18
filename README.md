<p align="center">
  <a href="https://farmjs.dev">
    <img src="./.github/assets/farmjs-lockup.svg" alt="Farm.js" width="420" />
  </a>
</p>

<p align="center">
  A modern React meta-framework built on Vite with Next.js-like semantics, featuring React Server Components, Server Actions, and a blazing-fast development experience.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Ready-blue.svg" alt="TypeScript ready" /></a>
</p>

## ✨ Features

- 🚀 **Blazing Fast**: Built on Vite for instant server start and lightning-fast HMR
- 🧪 Plugin Ecosystem like logging and infra related.
- ⚛️ **React Server Components**: Full RSC support with streaming SSR
- 🎯 **Next.js-like API**: Familiar file-based routing and app directory structure
- 🔄 **Server Actions**: Seamless server-client data mutations
- 📦 **Zero Config**: Works out of the box with sensible defaults
- 🎨 **Tailwind CSS Built-in**: Pre-configured Tailwind - just use classes!
- 🧪 **Type Safe**: Full TypeScript support throughout
- 🤖 **AI-Friendly**: Clean, predictable code structure for AI code generation

## 🚀 Quick Start

### Create a New App

```bash
pnpm create farm-app my-app
cd my-app
pnpm install
pnpm dev
```

Your app will be running at `http://localhost:3000`!

### Manual Installation

```bash
npm install @farmjs/core react react-dom
# or
pnpm add @farmjs/core react react-dom
# or
yarn add @farmjs/core react react-dom
```

Create a `farm.config.ts`:

```ts
import { defineConfig } from "@farmjs/core";

export default defineConfig({
  srcDir: "src",
  deploy: {
    target: "vercel",
  },
});
```

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
import type { LayoutProps } from "@farmjs/core";

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
import { defineConfig } from "@farmjs/core";

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
import { defineConfig } from "@farmjs/core";

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
import { definePlugin } from "@farmjs/core";

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

Visit [farm.js.dev](https://farm.js.dev) for comprehensive documentation, guides, and API reference.

## 🏗️ Development

### Prerequisites

- Node.js 18+
- pnpm 8+

### Setup

```bash
git clone https://github.com/farm-js/farm.js.git
cd farm.js
./scripts/setup.sh
```

### Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (from root: runs tests in all packages; @farmjs/core runs Vitest)
pnpm test

# Run only @farmjs/core tests
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
│   ├── farm-cli/          # @farmjs/cli tools
│   ├── create-farm-app/   # App creation tool
│   └── farm-types/        # TypeScript definitions
├── examples/
│   ├── basic/             # Basic example
│   ├── with-database/     # Database integration
│   └── e-commerce/        # E-commerce example
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
4. Create a changeset: `pnpm changeset`
5. Push and create a Pull Request

## 🌟 Examples

- **[Basic Example](./examples/basic)** - Simple Farm.js application
- **[With Database](./examples/with-database)** - Database integration patterns
- **[E-commerce](./examples/e-commerce)** - Full-featured online store

## 🔗 Ecosystem

- **[Vite](https://vitejs.dev/)** - Build tool and development server
- **[React](https://react.dev/)** - UI library with Server Components
- **[TypeScript](https://www.typescriptlang.org/)** - Type safety and developer experience

## 📄 License

MIT © [Farm.js Team](https://github.com/farm-js)

## 🙏 Acknowledgments

Farm.js is inspired by:

- **[Next.js](https://nextjs.org/)** - For the excellent App Router API design
- **[Vite](https://vitejs.dev/)** - For the incredible development experience
- **[@lazarv/react-server](https://github.com/lazarv/react-server)** - For RSC implementation insights
- **[Remix](https://remix.run/)** - For web-first development principles

---

<div align="center">

**[Documentation](https://farm.js.dev)** • **[Examples](./examples)** • **[Contributing](CONTRIBUTING.md)**

Made with ❤️ by&nbsp;<a href="https://www.farming-labs.dev"><img src="./.github/assets/farming-labs-mark.svg" alt="" height="18" align="center" />&nbsp;Farming Labs</a> team

</div>
