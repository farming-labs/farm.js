import { Link } from "@farmjs/core";

export const metadata = {
  title: "API Client - Farm.js",
  description:
    "Promise-based typed API client for Farm.js with cache policies, invalidation, optimistic updates, and lifecycle callbacks.",
};

export default function APIClientDocsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">API Client</h1>
        <p className="mt-2 text-slate-600">
          Farm.js includes a typed promise-based API client for calling your app routes from the
          browser without introducing a hook-only data layer.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Core shape</h2>
        <p className="mt-2 text-slate-600">
          API routes compile into typed client calls such as <code>api.users.get()</code>,
          <code>api.users.post()</code>, <code>api.users.patch()</code>, and{" "}
          <code>api.users.delete()</code>.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { createAPIClient } from "@farmjs/core/client";
import type { APIRouter } from "./api.generated";

export const api = createAPIClient<APIRouter>();

const result = await api.users.get(
  { query: { limit: "5" } },
  {
    cache: { policy: "cache-first", staleTime: 5000 },
  },
);

if (result.error) {
  console.error(result.error);
} else {
  console.log(result.data);
  console.log(result.key);
}`}
        </pre>
        <p className="mt-3 text-slate-600">
          Every client call resolves to <code>{`{ data, error, key }`}</code>. It does not throw for
          HTTP errors. That keeps plain promise flows predictable and makes optimistic and cache
          logic easier to compose.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Client options</h2>
        <p className="mt-2 text-slate-600">
          The second argument controls cache, retry, invalidation, optimistic writes, and lifecycle
          callbacks.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`const result = await api.users.post(
  { body: { name: "Ada", email: "ada@example.com" } },
  {
    key: "demo:users:create",
    retry: { count: 2, delay: 250 },
    invalidate: [[api.users.get, { query: { limit: "5" } }]],
    onRequest: (event) => console.log(event.method, event.path, event.attempt),
    onResponse: (data, error, event) => console.log(data, error, event.status),
    onSuccess: (data) => console.log("success", data),
    onError: (error) => console.log("error", error),
    onSettled: (data, error) => console.log("settled", data, error),
    onStatus: (event) => console.log(event.phase, event.key),
  }
);`}
        </pre>
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <p>
            <strong>Cache policies:</strong> <code>cache-first</code>, <code>network-only</code>,
            and <code>stale-while-revalidate</code>.
          </p>
          <p className="mt-2">
            <strong>Invalidation targets:</strong> route refs like{" "}
            <code>[api.users.get, {`{ query: { limit: "5" } }`}]</code>, a returned typed cache key
            like <code>users.key</code>, or a raw string key if you want a manual namespace.
          </p>
          <p className="mt-2">
            <strong>Invalidation behavior:</strong> invalidated entries are marked stale, so the
            next matching read fetches fresh server data and replaces the optimistic cache state.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Lifecycle hooks</h2>
        <p className="mt-2 text-slate-600">
          The client exposes plain callbacks instead of a hook-specific mutation object.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
          <li>
            <code>onRequest(event)</code>: runs before the network call. Use it for logging or local
            pending state.
          </li>
          <li>
            <code>onResponse(data, error, event)</code>: runs after the response is parsed. One of{" "}
            <code>data</code> or <code>error</code> is populated.
          </li>
          <li>
            <code>onSuccess(data)</code>: runs only for successful responses.
          </li>
          <li>
            <code>onError(error)</code>: runs only for failed responses.
          </li>
          <li>
            <code>onSettled(data, error)</code>: runs in both cases after success or failure.
          </li>
          <li>
            <code>onStatus(event)</code>: receives client status transitions for cache hits, pending
            requests, success, error, invalidation, and rollback.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Optimistic updates</h2>
        <p className="mt-2 text-slate-600">
          Optimistic updates patch the cached query result before the network request finishes.
          Internally the client snapshots the previous cache entry, applies your updater
          immediately, performs the request, then either keeps the result or rolls back if the
          mutation fails.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`const users = await api.users.get(
  { query: { limit: "5" } },
  {
    key: "demo:users:list",
    cache: { policy: "cache-first", staleTime: 5000 },
  }
);

await api.users.post(
  { body: { name: "Ada", email: "ada@example.com" } },
  {
    optimistic: {
      update: [
        [
          api.users.get,
          { query: { limit: "5" } },
          (prev) => ({
            users: [
              { id: "temp-route", name: "Ada", email: "ada@example.com" },
              ...(prev?.users ?? []),
            ],
            total: (prev?.total ?? 0) + 1,
            limit: prev?.limit ?? 5,
            offset: prev?.offset ?? 0,
          }),
        ],
        [
          users.key,
          (prev) => ({
            users: [
              { id: "temp-key", name: "Ada", email: "ada@example.com" },
              ...(prev?.users ?? []),
            ],
            total: (prev?.total ?? 0) + 1,
            limit: prev?.limit ?? 5,
            offset: prev?.offset ?? 0,
          }),
        ],
      ],
      rollbackOnError: true,
    },
    invalidate: [users.key],
  }
);`}
        </pre>
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p>
            <strong>Recommended:</strong> use the returned <code>users.key</code> when you already
            have the query result. That keeps the optimistic updater fully typed without manual
            casts.
          </p>
          <p className="mt-2">
            <strong>Important:</strong> a raw string key cannot carry a data shape on its own, so
            route refs or typed returned keys are better when you want full inference.
          </p>
        </div>
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-slate-700">
          <li>The client snapshots the current cached value for every optimistic target.</li>
          <li>Your updater runs immediately and writes the optimistic value into the cache.</li>
          <li>While the request is still pending, matching reads return that optimistic value.</li>
          <li>
            If the mutation succeeds, invalidation lets the next read replace the optimistic data
            with the server result.
          </li>
          <li>
            If the mutation fails and <code>rollbackOnError</code> is enabled, the snapshot is
            restored.
          </li>
        </ol>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">What is verified</h2>
        <p className="mt-2 text-slate-600">
          The current implementation is covered by both runtime and typing tests in the framework
          package.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
          <li>Cache-first reads reuse cached data and emit status events.</li>
          <li>Invalidation marks cached queries stale and causes the next read to refetch.</li>
          <li>Failed optimistic mutations roll back to the previous cached value.</li>
          <li>
            Pending optimistic mutations expose the optimistic data before the mutation settles.
          </li>
          <li>
            Delayed optimistic mutations keep the optimistic data visible during the timeout window
            before the server response resolves.
          </li>
          <li>
            Typing tests verify that optimistic updater <code>prev</code> is inferred from route
            refs and typed cache keys rather than falling back to <code>any</code>.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Current scope</h2>
        <p className="mt-2 text-slate-600">
          This client intentionally stays promise-based. It gives you cache, invalidation,
          optimistic updates, retries, and typed lifecycle hooks without requiring a hook-first
          query client model.
        </p>
        <p className="mt-3 text-slate-600">
          That means it does not currently aim to mirror every observer-driven TanStack Query
          feature such as automatic focus refetch subscriptions, polling, devtools, or infinite
          query helpers.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">See it live</h2>
        <p className="mt-2 text-slate-600">
          The example app includes interactive demos for basic client calls and advanced optimistic
          behaviors.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link href="/docs" className="text-emerald-600 hover:underline">
            Docs index
          </Link>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500">Example routes:</span>
          <code>/api-demo-client</code>
          <code>/api-demo-client-advanced</code>
        </div>
      </section>

      <nav className="flex gap-4 border-t border-slate-200 pt-8">
        <Link href="/docs/query" className="text-sm font-medium text-emerald-600 hover:underline">
          ← Query
        </Link>
        <Link href="/docs/layouts" className="text-sm font-medium text-emerald-600 hover:underline">
          Layouts →
        </Link>
      </nav>
    </div>
  );
}
