import type { PageProps } from "@farmjs/core";
import { Link } from "@farmjs/core/client";

export const metadata = {
  title: "Plugin Ecosystem - Farm.js",
  description: "Built-in plugins and how to use them in your Farm.js application.",
};

export default function PluginsPage(props: PageProps) {
  const demoRequestId = props.context?.data.get("demo.requestId") as string | undefined;
  const demoPath = props.context?.data.get("demo.path") as string | undefined;
  const demoUser = props.context?.data.get("demo.user") as string | undefined;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Plugin Ecosystem</h1>
        <p className="mt-2 text-slate-600">
          Farm.js uses a plugin system so you can add logging, compression, redirects, headers,
          rewrites, and environment handling without touching core code.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Using plugins</h2>
        <p className="mt-2 text-slate-600">
          Add plugins in{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
            farm.config.ts
          </code>{" "}
          via the{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">plugins</code>{" "}
          array. Plugins run in order; you can control order with{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
            enforce: "pre"
          </code>{" "}
          or <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">"post"</code>.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { defineFarmConfig } from "@farmjs/core";
import {
  createLoggerPlugin,
  createCompressionPlugin,
} from "@farmjs/core/plugin/server";

export default defineFarmConfig({
  srcDir: "src",
  plugins: [
    createLoggerPlugin({}),
    createCompressionPlugin({}),
  ],
});`}
        </pre>
      </section>

      <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-6">
        <h2 className="text-xl font-semibold text-slate-900">Live Request Context Demo</h2>
        <p className="mt-2 text-slate-600">
          This page is currently using a custom plugin from{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
            docs/farm.config.ts
          </code>{" "}
          that writes request-scoped values into{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
            props.context
          </code>
          .
        </p>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded border border-blue-200 bg-white p-3">
            <p className="font-medium text-slate-700">demo.requestId</p>
            <p className="mt-1 font-mono text-slate-900">{demoRequestId || "N/A"}</p>
          </div>
          <div className="rounded border border-blue-200 bg-white p-3">
            <p className="font-medium text-slate-700">demo.path</p>
            <p className="mt-1 font-mono text-slate-900">{demoPath || "N/A"}</p>
          </div>
          <div className="rounded border border-blue-200 bg-white p-3">
            <p className="font-medium text-slate-700">demo.user</p>
            <p className="mt-1 font-mono text-slate-900">{demoUser || "N/A"}</p>
          </div>
        </div>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { defineFarmConfig, definePlugin } from "@farmjs/core";
import { randomUUID } from "crypto";

function createDocsContextDemoPlugin(options = {}) {
  const userHeader = (options.userHeader || "x-docs-user").toLowerCase();
  const defaultUser = options.defaultUser || "guest";
  const log = options.log ?? true;

  return definePlugin({
    name: "docs-context-demo",
    beforeRequest(req, _res, context) {
      const pathname = req.url ? req.url.split("?")[0] : "/";
      const headerUser = req.headers[userHeader];
      const user = (Array.isArray(headerUser) ? headerUser[0] : headerUser) || defaultUser;
      const requestId = randomUUID();

      context.requestContext.set(req, "demo.requestId", requestId, { exposeToPage: true });
      context.requestContext.set(req, "demo.path", pathname, { exposeToPage: true });
      context.requestContext.set(req, "demo.user", user, { exposeToPage: true });
      context.requestContext.set(req, "internal.startTs", Date.now());

      if (log) {
        console.log(\`[docs-context-demo] \${req.method || "GET"} \${pathname} user=\${user} id=\${requestId}\`);
      }
    },
  });
}`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Built-in plugins</h2>
        <p className="mt-2 text-slate-600">
          Import server plugins from{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
            @farmjs/core/plugin/server
          </code>
          .
        </p>

        <div className="mt-6 space-y-6">
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="font-semibold text-slate-900">createLoggerPlugin</h3>
            <p className="mt-1 text-sm text-slate-600">
              Request/response logging. Use for development or custom logging. Supports optional{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                beforeRequest
              </code>{" "}
              and{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                afterResponse
              </code>{" "}
              overrides.
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
              {`import { createLoggerPlugin } from "@farmjs/core/plugin/server";
plugins: [createLoggerPlugin({})]`}
            </pre>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="font-semibold text-slate-900">createCompressionPlugin</h3>
            <p className="mt-1 text-sm text-slate-600">
              Sets{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                Content-Encoding
              </code>{" "}
              (gzip/br) in production based on{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                Accept-Encoding
              </code>
              . Typically used in production builds.
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
              {`import { createCompressionPlugin } from "@farmjs/core/plugin/server";
plugins: [createCompressionPlugin({})]`}
            </pre>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="font-semibold text-slate-900">createRedirectsPlugin</h3>
            <p className="mt-1 text-sm text-slate-600">
              Redirects by path pattern. Use with{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
                redirects()
              </code>{" "}
              in config.
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
              {`import { createRedirectsPlugin } from "@farmjs/core/plugin/server";
async redirects() {
  return [
    { source: "/old", destination: "/new", permanent: true },
  ];
}
// Plugin is applied when you use redirects in farm.config`}
            </pre>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="font-semibold text-slate-900">createHeadersPlugin</h3>
            <p className="mt-1 text-sm text-slate-600">
              Adds response headers by path. Use with{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">headers()</code>{" "}
              in config.
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
              {`async headers() {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
  ];
}`}
            </pre>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="font-semibold text-slate-900">createRewritesPlugin</h3>
            <p className="mt-1 text-sm text-slate-600">
              Rewrites URL paths internally. Use with{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">rewrites()</code>{" "}
              in config.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="font-semibold text-slate-900">createEnvPlugin</h3>
            <p className="mt-1 text-sm text-slate-600">
              Injects environment variables or env-based behavior into the request/response
              pipeline.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Order and enforce</h2>
        <p className="mt-2 text-slate-600">
          Plugins can set{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
            enforce: "pre"
          </code>{" "}
          to run before normal plugins, or{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
            enforce: "post"
          </code>{" "}
          to run after. Request hooks (
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">beforeRequest</code>,{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">afterResponse</code>)
          run in that order and can short-circuit the pipeline.
        </p>
      </section>

      <section className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-6">
        <h2 className="text-xl font-semibold text-slate-900">Create your own plugin</h2>
        <p className="mt-2 text-slate-600">
          You can define custom plugins with{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">definePlugin</code>{" "}
          and hook into config, requests, responses, and build. See the guide below.
        </p>
        <Link
          href="/docs/plugins/create-plugin"
          className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          How to create a plugin →
        </Link>
      </section>
    </div>
  );
}
