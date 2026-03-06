import type { PageProps } from "@farmjs/core";
import { Link } from "@farmjs/core";

export const metadata = {
  title: "Docs - Farm.js",
  description: "Farm.js documentation - Getting started, routing, layouts, and more.",
};

export default function DocsIndexPage(_props: PageProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Documentation</h1>
        <p className="mt-2 text-slate-600">
          Learn how to build modern React applications with Farm.js.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Link
          href="/docs/getting-started"
          className="group block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md"
        >
          <h2 className="text-lg font-semibold text-slate-900 group-hover:text-emerald-600">
            Getting Started
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Install Farm.js, create your first app, and run the dev server.
          </p>
        </Link>
        <Link
          href="/docs/routing"
          className="group block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md"
        >
          <h2 className="text-lg font-semibold text-slate-900 group-hover:text-emerald-600">
            Routing
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            File-based routing, dynamic segments, and navigation.
          </p>
        </Link>
        <Link
          href="/docs/layouts"
          className="group block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md"
        >
          <h2 className="text-lg font-semibold text-slate-900 group-hover:text-emerald-600">
            Layouts
          </h2>
          <p className="mt-2 text-sm text-slate-600">Root and nested layouts to wrap your pages.</p>
        </Link>
        <Link
          href="/docs/plugins"
          className="group block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md"
        >
          <h2 className="text-lg font-semibold text-slate-900 group-hover:text-emerald-600">
            Plugin Ecosystem
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Built-in plugins: logger, compression, redirects, headers, rewrites, env.
          </p>
        </Link>
        <Link
          href="/docs/plugins/create-plugin"
          className="group block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md"
        >
          <h2 className="text-lg font-semibold text-slate-900 group-hover:text-emerald-600">
            Create a Plugin
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Guide to building your own plugin with definePlugin and lifecycle hooks.
          </p>
        </Link>
      </div>
    </div>
  );
}
