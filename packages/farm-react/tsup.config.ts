import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
    client: "src/client.ts",
    "compiler-runtime": "src/compiler-runtime.tsx",
    "compiled-root": "src/compiled-root.ts",
    list: "src/list.tsx",
    vite: "src/vite.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    "@babel/core",
    "@farm.js/core",
    "@farm.js/core/renderer/react/client",
    "@farm.js/core/renderer/react/server",
    "react",
    "react-dom",
    "react-dom/client",
    "react-dom/server",
    "vite",
  ],
  esbuildPlugins: [
    {
      // compiled-root must use the runtime entry's module instance, not a bundled copy.
      name: "farm-shared-compiler-runtime",
      setup(build) {
        build.onResolve({ filter: /^\.\/compiler-runtime$/ }, (args) =>
          args.importer.endsWith("compiled-root.ts")
            ? { path: "@farm.js/react/compiler-runtime", external: true }
            : undefined,
        );
      },
    },
  ],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});
