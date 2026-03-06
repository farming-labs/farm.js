import type { PageProps } from "@farmjs/core";
import { Link } from "@farmjs/core";

export const metadata = {
  title: "Create a Plugin - Farm.js",
  description: "Guide to building your own Farm.js plugin with definePlugin and lifecycle hooks.",
};

export default function CreatePluginPage(_props: PageProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">How to create your own plugin</h1>
        <p className="mt-2 text-slate-600">
          Use <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">definePlugin</code> and the{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">FarmPlugin</code> interface to add custom
          behavior to your Farm.js app.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Plugin interface</h2>
        <p className="mt-2 text-slate-600">
          A plugin is an object with a <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">name</code> and
          optional lifecycle hooks. Import the type and helper from the core package:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { definePlugin, type FarmPlugin, type FarmPluginContext } from "@farmjs/core";`}
        </pre>
        <p className="mt-4 text-slate-600">
          <strong>Context</strong> passed to hooks: <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">config</code>,{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">viteServer</code> (in dev),{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">isDev</code>,{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">isProd</code>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Lifecycle hooks</h2>
        <ul className="mt-2 list-inside list-disc space-y-2 text-slate-600">
          <li>
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-sm">config</code> – Modify or return a new config (runs early).
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-sm">configResolved</code> – Called after config is resolved.
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-sm">beforeRequest</code> – Run before handling each request; can send a response and stop the pipeline.
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-sm">afterResponse</code> – Run after the response is prepared.
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-sm">buildStart</code> / <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-sm">buildEnd</code> – Run at build start/end.
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-sm">transformHTML</code> / <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-sm">transformPage</code> – Transform final HTML or page component (if supported).
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Minimal example</h2>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { definePlugin, type FarmPlugin } from "@farmjs/core";

export const myPlugin = definePlugin({
  name: "my-farm-plugin",
  version: "1.0.0",

  async beforeRequest(req, res, context) {
    if (context.isDev) {
      res.setHeader("X-My-Plugin", "hello");
    }
  },
});`}
        </pre>
        <p className="mt-4 text-slate-600">
          Register it in <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">farm.config.ts</code>:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { defineFarmConfig } from "@farmjs/core";
import { myPlugin } from "./plugins/my-plugin";

export default defineFarmConfig({
  plugins: [myPlugin],
});`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Enforce order</h2>
        <p className="mt-2 text-slate-600">
          Use <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">enforce: "pre"</code> to run before other plugins, or{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">enforce: "post"</code> to run after.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`definePlugin({
  name: "early-plugin",
  enforce: "pre",
  beforeRequest(req, res) {
    // Runs before normal plugins
  },
});`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Modifying config</h2>
        <p className="mt-2 text-slate-600">
          Return a new config from the <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">config</code> hook to merge or override settings.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`definePlugin({
  name: "config-plugin",
  config(config, context) {
    return {
      ...config,
      // your overrides
    };
  },
});`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Request and response</h2>
        <p className="mt-2 text-slate-600">
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">beforeRequest</code> receives{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">(req, res, context)</code>. If you write
          to <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">res</code> and end the response, the request is considered handled.{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">afterResponse</code> runs after the response is ready; use it for logging or last-mile headers.
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50/50 p-6">
        <h2 className="text-xl font-semibold text-slate-900">Publishing a plugin</h2>
        <p className="mt-2 text-slate-600">
          Package your plugin as an npm package that exports one or more plugins. List{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">@farmjs/core</code> as a peer dependency so users install the version that matches their Farm.js app.
        </p>
      </section>

      <p className="pt-4">
        <Link href="/docs/plugins" className="text-emerald-600 hover:underline">
          ← Plugin ecosystem
        </Link>
      </p>
    </div>
  );
}
