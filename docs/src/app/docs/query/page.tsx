import { Link } from "@farmjs/core";
import type { PagePropsSafe } from "@farmjs/core/query";
import {
  asBoolean,
  asInteger,
  asString,
  loadRouteParams,
  loadSearchParams,
} from "@farmjs/core/query/server";

export const metadata = {
  title: "Query - Farm.js",
  description: "Type-safe query and route params in Farm.js on both server and client.",
};

export default async function QueryDocsPage({ searchParams, params }: PagePropsSafe) {
  const query = await loadSearchParams(searchParams, {
    q: asString.withDefault!("farm"),
    page: asInteger.withDefault!(1),
    draft: asBoolean.withDefault!(false),
  });
  console.log("query", query);
  const route = await loadRouteParams(params, {
    section: asString.withDefault!("query"),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Query</h1>
        <p className="mt-2 text-slate-600">
          Farm.js includes type-safe query helpers for server and client code.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Server-side parsing</h2>
        <p className="mt-2 text-slate-600">
          Use <code>loadSearchParams</code> to parse URL query values and{" "}
          <code>loadRouteParams</code> for dynamic route params.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import type { PagePropsSafe } from "@farmjs/core/query";
import { loadSearchParams, loadRouteParams, asString, asInteger } from "@farmjs/core/query/server";

export default async function Page({ searchParams, params }: PagePropsSafe) {
  const query = await loadSearchParams(searchParams, {
    q: asString.withDefault!(""),
    page: asInteger.withDefault!(1),
  });

  const route = await loadRouteParams(params, {
    id: asInteger.withDefault!(0),
  });

  return <div>{query.q} - {route.id}</div>;
}`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Try it now</h2>
        <p className="mt-2 text-slate-600">
          Open this page with query params and see the parsed values below.
        </p>
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">
            <strong>Parsed query:</strong> q=<code>{query.q}</code>, page=<code>{query.page}</code>,
            draft=<code>{String(query.draft)}</code>
          </p>
          <p className="mt-2 text-sm text-slate-700">
            <strong>Parsed route:</strong> section=<code>{route.section}</code>
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link
              href="/docs/query?q=farmjs&page=2&draft=true"
              className="text-emerald-600 hover:underline"
            >
              /docs/query?q=farmjs&page=2&draft=true
            </Link>
            <Link href="/docs/query?q=plugin&page=5" className="text-emerald-600 hover:underline">
              /docs/query?q=plugin&page=5
            </Link>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Client-side query state</h2>
        <p className="mt-2 text-slate-600">
          Use <code>useQueryState</code> from <code>@farmjs/core/query/client</code> to keep UI
          state in the URL.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`'use client';
import { useQueryState, asString, asInteger } from "@farmjs/core/query/client";

export default function SearchControls() {
  const [q, setQ] = useQueryState("q", asString.withDefault!(""));
  const [page, setPage] = useQueryState("page", asInteger.withDefault!(1));

  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} />
      <button onClick={() => setPage(page + 1)}>Next page</button>
    </div>
  );
}`}
        </pre>
      </section>

      <nav className="flex gap-4 border-t border-slate-200 pt-8">
        <Link href="/docs/routing" className="text-sm font-medium text-emerald-600 hover:underline">
          ← Routing
        </Link>
        <Link href="/docs/layouts" className="text-sm font-medium text-emerald-600 hover:underline">
          Layouts →
        </Link>
      </nav>
    </div>
  );
}
