---
title: "Getting Started"
description: "Create a Farm.js app, understand the files that matter, and run the development server."
section: "Start"
---

# Getting Started

Create a Farm.js app, understand the files that matter, and run the development server.

## Create an app

Farm keeps the first project small: an app directory, a config file, package metadata, and TypeScript. Vite config and platform config are optional escape hatches, not required setup.

**Terminal**

```bash
pnpm create farm-app my-app
cd my-app
pnpm install
pnpm dev
```

## What you get

- File-based routes in src/app.
- React rendering with pages, layouts, loading, error, and not-found boundaries.
- Typed Link hrefs generated from the route tree.
- API routes and a generated client for api.users.get style calls.
- Deployment output powered by Farm config instead of extra root files.

## Your first page

**src/app/page.tsx**

```tsx
import type { PageProps } from "@farmjs/core";

export default function HomePage(_props: PageProps) {
  return <h1>Hello from Farm.js</h1>;
}
```
