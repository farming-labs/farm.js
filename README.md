# 🚜 Farm.js

A modern React meta-framework built on Vite with Next.js-like semantics, featuring React Server Components, Server Actions, and blazing-fast development experience.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

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

Create a `vite.config.ts`:

```ts
import { defineConfig } from "@farmjs/core/vite";

export default defineConfig();
```

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
├── package.json
└── vite.config.ts
```

## ⚙️ Configuration

Farm.js supports a powerful configuration system via `farm.config.ts`:

```typescript
import { defineFarmConfig } from "@farmjs/core";

export default defineFarmConfig({
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

# Run tests
pnpm test

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

Made with ❤️ by the Farm.js team

</div>
