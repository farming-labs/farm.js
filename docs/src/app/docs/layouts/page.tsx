import type { PageProps } from '@farmjs/core';
import { Link } from '@farmjs/core/client';

export const metadata = {
  title: 'Layouts - Farm.js',
  description: 'Root and nested layouts in Farm.js.',
};

export default function LayoutsPage(_props: PageProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Layouts</h1>
        <p className="mt-2 text-slate-600">
          Layouts wrap pages and persist across navigations. Use them for shared UI like headers and sidebars.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Root layout</h2>
        <p className="mt-2 text-slate-600">
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">app/layout.tsx</code> is the root layout. It wraps every page and typically includes <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">html</code> and <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">body</code> structure. In Farm.js the framework injects the document shell; your layout receives <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">children</code>.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
{`// app/layout.tsx
import type { LayoutProps } from "@farmjs/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen">
      <header>{/* nav */}</header>
      <main>{children}</main>
      <footer>{/* footer */}</footer>
    </div>
  );
}`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Nested layouts</h2>
        <p className="mt-2 text-slate-600">
          Add a <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">layout.tsx</code> inside any route segment. It wraps all pages under that segment.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
{`// app/docs/layout.tsx
import type { LayoutProps } from "@farmjs/core";

export default function DocsLayout({ children }: LayoutProps) {
  return (
    <div className="flex gap-8">
      <aside>{/* sidebar */}</aside>
      <article>{children}</article>
    </div>
  );
}`}
        </pre>
        <p className="mt-4 text-slate-600">
          All routes under <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">/docs</code> will use this layout, with the root layout as the outer wrapper.
        </p>
      </section>

      <nav className="flex gap-4 pt-8 border-t border-slate-200">
        <Link href="/docs/routing" className="text-sm font-medium text-emerald-600 hover:underline">
          ← Routing
        </Link>
        <Link href="/docs" className="text-sm font-medium text-emerald-600 hover:underline">
          Introduction →
        </Link>
      </nav>
    </div>
  );
}
