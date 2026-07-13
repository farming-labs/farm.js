import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
    client: "src/client.ts",
    vite: "src/vite.ts",
    "server-plugins": "src/server-plugins.ts",
    "client-plugins": "src/client-plugins.ts",
    "query/index": "src/query/index.ts",
    "query/parsers": "src/query/parsers.ts",
    "query/client": "src/query/client.ts",
    "query/server": "src/query/server.ts",
    middleware: "src/middleware/index.ts",
    api: "src/api/index.ts",
    router: "src/router.ts",
    routes: "src/routes.ts",
    plugin: "src/plugin.ts",
    storage: "src/storage/index.ts",
    cache: "src/cache.ts",
    navigation: "src/navigation.ts",
    headers: "src/headers.ts",
    docs: "src/docs/index.ts",
    markdown: "src/markdown.ts",
    "app-markdown": "src/app-markdown.ts",
    observability: "src/observability.ts",
    workflows: "src/workflows.ts",
    "server-fn": "src/server-fn.ts",
    "server-fn-client": "src/server-fn-client.ts",
    "server-action-security": "src/server-action-security.ts",
    deployment: "src/deployment.ts",
    env: "src/env.ts",
    "env-types": "src/env-types.ts",
    environment: "src/environment.ts",
    "environment/vite": "src/environment-vite.ts",
    testing: "src/testing.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  external: ["react", "react-dom", "vite", /^@farming-labs\/orm/],
  sourcemap: true,
  splitting: false,
  treeshake: false,
  onSuccess:
    "node -e \"require('fs').copyFileSync('src/docs/pixel-border.css','dist/pixel-border.css')\"",
  esbuildOptions(options) {
    options.keepNames = true;
    return options;
  },
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});
