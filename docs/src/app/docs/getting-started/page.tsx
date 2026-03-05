import type { PageProps } from '@farmjs/core';
import { Link } from '@farmjs/core/client';

export const metadata = {
  title: 'Getting Started - Farm.js',
  description: 'Learn how to install and run your first Farm.js application.',
};

export default function GettingStartedPage(_props: PageProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Getting Started</h1>
        <p className="mt-2 text-slate-600">
          Get Farm.js up and running in a few minutes.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Installation</h2>
        <p className="mt-2 text-slate-600">
          Create a new Farm.js application using the CLI:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
{`pnpm create farm-app my-app
cd my-app
pnpm install
pnpm dev`}
        </pre>
        <p className="mt-4 text-slate-600">
          Your app will be available at <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">http://localhost:3000</code>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Project structure</h2>
        <p className="mt-2 text-slate-600">
          Farm.js uses a familiar app directory structure:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
{`my-app/
├── src/
│   └── app/
│       ├── layout.tsx    # Root layout
│       ├── page.tsx      # Home page (/)
│       ├── about/
│       │   └── page.tsx  # /about
│       └── users/
│           ├── page.tsx  # /users
│           └── [id]/
│               └── page.tsx  # /users/:id
├── farm.config.ts
├── package.json
└── vite.config.ts`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Your first page</h2>
        <p className="mt-2 text-slate-600">
          Create a page by adding a <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">page.tsx</code> file:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
{`// src/app/page.tsx
import type { PageProps } from "@farmjs/core";

export default function HomePage({ params, searchParams }: PageProps) {
  return (
    <div>
      <h1>Hello from Farm.js!</h1>
    </div>
  );
}`}
        </pre>
      </section>

      <nav className="flex gap-4 pt-8 border-t border-slate-200">
        <Link href="/docs" className="text-sm font-medium text-emerald-600 hover:underline">
          ← Introduction
        </Link>
        <Link href="/docs/routing" className="text-sm font-medium text-emerald-600 hover:underline">
          Routing →
        </Link>
      </nav>
    </div>
  );
}
