import path from "node:path";
import { defineConfig, type Options } from "tsup";
import { restoreDynamicImportsInDirectory } from "./scripts/restore-cjs-dynamic-imports";
import { writeReactServerClientEntry } from "./scripts/write-react-server-client";

const entry = {
  index: "src/index.ts",
  version: "src/version.ts",
  server: "src/server.ts",
  client: "src/client.ts",
  "renderer-client": "src/renderer-client.ts",
  "client/lifecycle": "src/client/lifecycle.ts",
  vite: "src/vite.ts",
  "server-plugins": "src/server-plugins.ts",
  "client-plugins": "src/client-plugins.ts",
  "query/index": "src/query/index.ts",
  "query/parsers": "src/query/parsers.ts",
  "query/client": "src/query/client.ts",
  "query/server": "src/query/server.ts",
  middleware: "src/middleware/index.ts",
  api: "src/api/index.ts",
  "api/client": "src/api-client.ts",
  "api/runtime": "src/api/runtime.ts",
  "api/route-manager": "src/api/route-manager.ts",
  router: "src/router.ts",
  routes: "src/routes.ts",
  request: "src/request.ts",
  plugin: "src/plugin-entry.ts",
  integrations: "src/integrations.ts",
  schema: "src/schema.ts",
  storage: "src/storage/index.ts",
  cache: "src/cache.ts",
  deferred: "src/deferred.ts",
  after: "src/after.ts",
  platform: "src/platform.ts",
  desktop: "src/desktop/index.ts",
  "internal/desktop-guard": "src/desktop/guard.ts",
  navigation: "src/navigation.ts",
  headers: "src/headers.ts",
  "theme/index": "src/theme/index.ts",
  "theme/client": "src/theme/client.tsx",
  "theme/runtime": "src/theme/runtime.ts",
  "theme/server": "src/theme/server.ts",
  docs: "src/docs/index.ts",
  markdown: "src/markdown.ts",
  "app-markdown": "src/app-markdown.ts",
  observability: "src/observability.ts",
  instrumentation: "src/instrumentation.ts",
  workflows: "src/workflows.ts",
  cron: "src/cron.ts",
  "server-fn": "src/server-fn.ts",
  "server-fn-client": "src/server-fn-client.ts",
  "server-query": "src/server-query.ts",
  "server-query-client": "src/server-query-client.ts",
  "server-action-security": "src/server-action-security.ts",
  deployment: "src/deployment.ts",
  env: "src/env.ts",
  "env-types": "src/env-types.ts",
  environment: "src/environment.ts",
  font: "src/font.ts",
  "environment/vite": "src/environment-vite.ts",
  testing: "src/testing.ts",
  "agent-runtime": "src/agent-runtime.ts",
  "json-ld": "src/json-ld.ts",
  image: "src/image.tsx",
  "image/server": "src/image-server.ts",
  "image/sharp": "src/image-sharp.ts",
  og: "src/og.ts",
  "i18n/index": "src/i18n/index.ts",
  "i18n/server": "src/i18n/server.ts",
  "i18n/client": "src/i18n/client.tsx",
  "internal/client-runtime": "src/client/production-runtime.ts",
  "internal/client-error-overlay": "src/client/runtime-error-overlay.ts",
  "internal/isolated-boundary": "src/client/isolated-boundary.ts",
  "internal/island-value-store": "src/client/island-value-store.ts",
  "internal/island-codec": "src/client/island-codec.ts",
  "internal/server-tree": "src/client/server-tree.ts",
  "internal/islands-runtime": "src/client/islands-runtime.ts",
  "internal/islands-server": "src/client/islands-server.ts",
  "internal/islx-client": "src/islx/client.ts",
  "internal/islx-server": "src/islx/server.ts",
  "internal/islx-react": "src/islx/react.ts",
  "internal/form-actions": "src/form-actions.ts",
  "internal/form-actions-client": "src/form-actions-client.ts",
  "internal/production-runtime": "src/nitro/production-runtime.ts",
  "internal/product-telemetry-runtime": "src/product-telemetry.ts",
  "internal/infra-analytics-runtime": "src/infra-analytics-runtime.ts",
  "internal/metadata-image-runtime": "src/metadata-image.ts",
  "internal/app-markdown-runtime": "src/app-markdown-runtime.ts",
  "internal/docs-precompiled-runtime": "src/docs/precompiled-runtime.ts",
  "internal/compression-runtime": "src/plugins/compression.ts",
  "internal/build-runtime": "src/nitro/build-runtime.ts",
  "internal/config-runtime": "src/config-runtime.ts",
  "internal/production-node-env": "src/build/production-node-env.ts",
  "internal/cli-runtime": "src/cli-runtime.ts",
  "internal/request-cookies": "src/request-cookies.ts",
  config: "src/config-entry.ts",
  renderer: "src/renderer.ts",
  "renderer/react/server": "src/renderer/react/server.ts",
  "renderer/react/client": "src/renderer/react/client.ts",
  "renderer/react/vite": "src/renderer/react/vite.ts",
};

export const farmPackageBuildOptions = {
  entry,
  format: ["cjs", "esm"],
  // Declarations for every entry except the CLI's React-free runtime. Everything it exports
  // is typed by index.d.ts, which package.json points it at. The declaration worker peaks
  // around 10 GB on Node 22, so builds run with a 12 GB heap.
  dts: {
    entry: Object.fromEntries(
      Object.entries(entry).filter(([name]) => name !== "internal/cli-runtime"),
    ),
  },
  clean: true,
  external: [
    // Preserve the guarded import in CJS too, rather than inlining a retained
    // __esm initializer for the development-only diagnostics graph.
    "@farm.js/core/internal/client-error-overlay",
    "react",
    "react-dom",
    /^@farm\.js\/islx/,
    "@vercel/og",
    "rolldown",
    "sharp",
    "vite",
    /^@farming-labs\/orm/,
    "@farming-labs/docs",
  ],
  sourcemap: false,
  // Share chunks between CommonJS entries as ESM does. Unsplit, every CommonJS
  // entry inlined its own copy of the modules it imports.
  splitting: true,
  treeshake: false,
  esbuildOptions(options, { format }) {
    options.keepNames = true;
    // Split CommonJS is emitted as ESM and converted afterwards, which keeps
    // import.meta. Give it the empty object esbuild substitutes in CommonJS.
    if (format === "cjs") options.define = { ...options.define, "import.meta": "{}" };
    return options;
  },
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
  // Splitting converts CommonJS dynamic imports to require(); restore import().
  async onSuccess() {
    await restoreDynamicImportsInDirectory(path.join(process.cwd(), "dist"));
    await writeReactServerClientEntry(path.join(process.cwd(), "dist"));
  },
} satisfies Options;

export default defineConfig(farmPackageBuildOptions);
