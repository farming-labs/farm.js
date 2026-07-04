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
    plugin: "src/plugin.ts",
    storage: "src/storage/index.ts",
    cache: "src/cache.ts",
    docs: "src/docs/index.ts",
    markdown: "src/markdown.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  external: ["react", "react-dom", "vite", /^@farming-labs\/orm/],
  sourcemap: true,
  splitting: false,
  treeshake: false,
  esbuildOptions(options) {
    options.keepNames = true;
    return options;
  },
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});
