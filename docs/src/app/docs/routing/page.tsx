import type { PageProps } from "@farmjs/core";
import { Link } from "@farmjs/core";

export const metadata = {
  title: "Routing - Farm.js",
  description: "File-based routing, dynamic segments, and navigation in Farm.js.",
};

export default function RoutingPage(_props: PageProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Routing</h1>
        <p className="mt-2 text-slate-600">
          Farm.js uses file-based routing. The structure of your{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">src/app</code>{" "}
          directory defines your routes.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Basic routes</h2>
        <p className="mt-2 text-slate-600">
          Each{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">page.tsx</code>{" "}
          file becomes a route. The folder path is the URL path.
        </p>
        <ul className="mt-4 list-inside list-disc space-y-1 text-slate-600">
          <li>
            <code className="rounded bg-slate-100 px-1 font-mono text-sm">app/page.tsx</code> →{" "}
            <code className="rounded bg-slate-100 px-1 font-mono text-sm">/</code>
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1 font-mono text-sm">app/about/page.tsx</code>{" "}
            → <code className="rounded bg-slate-100 px-1 font-mono text-sm">/about</code>
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1 font-mono text-sm">app/blog/page.tsx</code> →{" "}
            <code className="rounded bg-slate-100 px-1 font-mono text-sm">/blog</code>
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Dynamic segments</h2>
        <p className="mt-2 text-slate-600">Use brackets for dynamic route parameters:</p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`// app/users/[id]/page.tsx
import type { PageProps } from "@farmjs/core";

export default function UserPage({ params }: PageProps) {
  const { id } = params ?? {};
  return <div>User: {id}</div>;
}`}
        </pre>
        <p className="mt-4 text-slate-600">
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">[id]</code> matches
          a single segment. Use{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">[...slug]</code>{" "}
          for catch-all routes.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Navigation</h2>
        <p className="mt-2 text-slate-600">
          Use the <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">Link</code>{" "}
          component from{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
            @farmjs/core/client
          </code>{" "}
          or the root export <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">@farmjs/core</code>{" "}
          for client-side navigation:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { Link } from "@farmjs/core";

<Link href="/about">About</Link>
<Link href="/users/123?tab=profile">User Tab</Link>
<Link href="/docs/layouts#nested-layouts">Nested Layouts</Link>`}
        </pre>
        <p className="mt-4 text-slate-600">
          Internal route typing also accepts query strings and hashes, so a generated route like{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">/users/{"${string}"}</code>{" "}
          can be used as <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">/users/123?tab=profile</code>{" "}
          without widening the type to plain <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">string</code>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Generated route typing</h2>
        <p className="mt-2 text-slate-600">
          Farm.js generates{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">src/farm-routes.d.ts</code>{" "}
          from your page tree. The generated union is what powers typed <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">href</code>{" "}
          values.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`/**
 * Auto-generated route types from src/app
 */
export type RoutePath =
  | "/"
  | "/about"
  | "/docs/reference"
  | \`/users/\${string}\`;`}
        </pre>
        <p className="mt-4 text-slate-600">
          Framework-defined routes can be included too. For example, if OpenAPI is enabled with{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">route: "/docs/reference"</code>,
          that path should be part of the generated route union.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Relaxing href checks</h2>
        <p className="mt-2 text-slate-600">
          If you intentionally want to disable route-typed links for an app, set{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">suppressLintOnLink</code>{" "}
          in <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">farm.config.ts</code>.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`export default defineFarmConfig({
  suppressLintOnLink: true,
});`}
        </pre>
        <p className="mt-4 text-slate-600">
          That changes the generated route type to plain <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">string</code>.
          Use it only when you explicitly do not want route validation on links.
        </p>
      </section>

      <nav className="flex gap-4 pt-8 border-t border-slate-200">
        <Link
          href="/docs/getting-started"
          className="text-sm font-medium text-emerald-600 hover:underline"
        >
          ← Getting Started
        </Link>
        <Link href="/docs/layouts" className="text-sm font-medium text-emerald-600 hover:underline">
          Layouts →
        </Link>
      </nav>
    </div>
  );
}
