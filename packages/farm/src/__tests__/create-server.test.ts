import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFarmClientOptimizeDepsConfig,
  createFarmClientOptimizeDepsEntries,
  createFarmSourceAlias,
  FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE,
  mergeFarmProductionViteConfig,
  mergeFarmViteConfig,
} from "../server/vite-config";

describe("mergeFarmViteConfig", () => {
  it("keeps Farm client runtimes in React's dependency optimizer generation", () => {
    expect(createFarmClientOptimizeDepsConfig()).toMatchObject({
      noDiscovery: false,
      holdUntilCrawlEnd: true,
      include: expect.arrayContaining([
        "react",
        "react-dom/client",
        "@farm.js/core/client",
        "@farm.js/core/plugin/client",
        "@farm.js/core/deferred",
        "@farm.js/core/deployment",
        "@farm.js/core/i18n/client",
        "@farm.js/core/query/client",
        "@farm.js/core/server-fn/client",
        "@farm.js/core/server-query/client",
      ]),
    });
    expect(FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE).toContain("react/jsx-dev-runtime");
  });

  it("scans route UI entries before serving dynamically imported pages", () => {
    const entries = createFarmClientOptimizeDepsEntries("/workspace/app", [
      "/workspace/layers/base/src/app",
      "/workspace/app/web/app",
    ]);

    expect(entries).toEqual([
      "../layers/base/src/app/**/{page,layout,loading,error,not-found,default}.{js,jsx,ts,tsx}",
      "web/app/**/{page,layout,loading,error,not-found,default}.{js,jsx,ts,tsx}",
    ]);
    expect(createFarmClientOptimizeDepsConfig(entries)?.entries).toEqual(entries);
  });

  it("maps @ to the configured application source directory", () => {
    expect(createFarmSourceAlias("/workspace/app", "web")).toEqual({
      "@": path.resolve("/workspace/app", "web"),
    });
  });

  it("preserves Farm plugins and dependency safeguards when user Vite config is merged", () => {
    const farmPlugin = { name: "farm:framework" };
    const userPlugin = { name: "app:plugin" };

    const merged = mergeFarmViteConfig(
      {
        plugins: [farmPlugin],
        server: { middlewareMode: false, port: 3000, strictPort: true },
        resolve: {
          alias: { "@": "/workspace/app/src", "farm-runtime": "/farm/runtime" },
          dedupe: ["react", "react-dom"],
        },
        optimizeDeps: {
          noDiscovery: true,
          entries: ["src/app/**/page.tsx"],
          include: ["react"],
          exclude: ["lightningcss", "@tailwindcss/oxide"],
        },
        ssr: { noExternal: ["farm"] },
      },
      {
        plugins: [userPlugin],
        server: { port: 4100, strictPort: false },
        resolve: {
          alias: { "@": "/workspace/app/custom-src", "app-only": "/app/only" },
          dedupe: ["react-dom", "react-is"],
        },
        optimizeDeps: {
          entries: ["src/browser-entry.ts"],
          include: ["react", "react-dom"],
          exclude: ["supports-color"],
        },
        ssr: { noExternal: ["app-runtime"] },
      },
    );

    expect(merged.plugins).toEqual([farmPlugin, userPlugin]);
    expect(merged.server).toMatchObject({
      middlewareMode: false,
      port: 4100,
      strictPort: false,
    });
    expect(merged.resolve?.dedupe).toEqual(["react", "react-dom", "react-is"]);
    expect(merged.resolve?.alias).toEqual({
      "@": "/workspace/app/custom-src",
      "farm-runtime": "/farm/runtime",
      "app-only": "/app/only",
    });
    expect(merged.optimizeDeps).toMatchObject({
      noDiscovery: true,
      entries: ["src/browser-entry.ts"],
      include: ["react", "react-dom"],
      exclude: ["lightningcss", "@tailwindcss/oxide", "supports-color"],
    });
    expect(merged.ssr?.noExternal).toEqual(["farm", "app-runtime"]);
  });

  it("lets applications opt out of discovery with an explicit dependency list", () => {
    const merged = mergeFarmViteConfig(
      { optimizeDeps: createFarmClientOptimizeDepsConfig() },
      {
        optimizeDeps: {
          noDiscovery: true,
          include: ["legacy-commonjs-package"],
        },
      },
    );

    expect(merged.optimizeDeps).toMatchObject({
      noDiscovery: true,
      holdUntilCrawlEnd: false,
      include: expect.arrayContaining(["react", "@farm.js/core/client", "legacy-commonjs-package"]),
    });
  });
});

describe("mergeFarmProductionViteConfig", () => {
  const farmPlugin = { name: "farm" };
  const userPlugin = { name: "user" };
  const farmConfig = {
    root: "/app",
    mode: "production",
    publicDir: "/app/public",
    plugins: [farmPlugin],
    build: {
      outDir: "/app/.farm/client",
      target: "es2020",
      rollupOptions: {
        input: { "farm-client": "/app/.farm/entry.js" },
        external: ["fsevents"],
      },
    },
    define: { __FARM_API_BASE_URL__: '"/api"' },
    esbuild: { jsxDev: false },
    css: { postcss: "/app/.farm/postcss" },
    resolve: { alias: { "@": "/app/src" } },
    ssr: { external: ["sharp"], noExternal: true as const },
  };

  it("applies app options the way development does", () => {
    const merged = mergeFarmProductionViteConfig(farmConfig, {
      plugins: [userPlugin],
      define: { __APP_FLAG__: '"on"' },
      css: { modules: { generateScopedName: "app-[local]" } },
      resolve: { alias: { "app-alias": "/app/vendor/alias.ts" } },
      esbuild: { legalComments: "none" },
      ssr: { external: ["app-native"] },
      json: { stringify: true },
      build: { sourcemap: true, rollupOptions: { treeshake: false } },
    });

    // App plugins are placed by the build itself, next to Farm's transforms.
    expect(merged.plugins).toEqual([farmPlugin]);
    expect(merged.define).toEqual({ __APP_FLAG__: '"on"', __FARM_API_BASE_URL__: '"/api"' });
    expect(merged.css).toEqual({
      postcss: "/app/.farm/postcss",
      modules: { generateScopedName: "app-[local]" },
    });
    expect(merged.resolve?.alias).toEqual({
      "@": "/app/src",
      "app-alias": "/app/vendor/alias.ts",
    });
    expect(merged.esbuild).toEqual({ legalComments: "none", jsxDev: false });
    expect(merged.ssr).toMatchObject({ external: ["sharp", "app-native"], noExternal: true });
    expect(merged.json).toEqual({ stringify: true });
    expect(merged.build).toMatchObject({
      sourcemap: true,
      rollupOptions: { treeshake: false, external: ["fsevents"] },
    });
  });

  it("keeps the options Farm owns for its production output", () => {
    const merged = mergeFarmProductionViteConfig(farmConfig, {
      root: "/elsewhere",
      base: "/elsewhere/",
      mode: "development",
      appType: "spa",
      publicDir: "/elsewhere/public",
      define: { __FARM_API_BASE_URL__: '"https://bogus.invalid"' },
      esbuild: { jsxDev: true },
      build: {
        outDir: "/elsewhere/out",
        emptyOutDir: false,
        ssr: true,
        ssrEmitAssets: true,
        write: false,
        lib: { entry: "/elsewhere/lib.ts" },
        watch: {},
        target: "es5",
        rollupOptions: {
          input: "/elsewhere/entry.js",
          output: { format: "cjs" },
          external: ["react"],
        },
        rolldownOptions: { input: "/elsewhere/rolldown.js" },
      },
    });

    expect(merged.root).toBe("/app");
    expect(merged.base).toBeUndefined();
    expect(merged.mode).toBe("production");
    expect(merged.appType).toBeUndefined();
    expect(merged.publicDir).toBe("/app/public");
    expect(merged.define).toEqual({ __FARM_API_BASE_URL__: '"/api"' });
    expect(merged.esbuild).toEqual({ jsxDev: false });
    expect(merged.build).toEqual({
      outDir: "/app/.farm/client",
      target: "es2020",
      rollupOptions: {
        input: { "farm-client": "/app/.farm/entry.js" },
        external: ["fsevents"],
      },
    });
  });

  describe("client output options", () => {
    const farmOutput = {
      entryFileNames: "[name]-h[hash].js",
      chunkFileNames: "chunks/[name]-h[hash].js",
      assetFileNames: "assets/[name]-h[hash][extname]",
      hashCharacters: "hex" as const,
    };
    const clientConfig = {
      ...farmConfig,
      build: {
        ...farmConfig.build,
        rollupOptions: { ...farmConfig.build.rollupOptions, output: farmOutput },
      },
    };
    const appGroups = { groups: [{ name: "vendor", test: /node_modules/, minShareCount: 2 }] };

    it("keeps the app's chunking and output options under the names Farm owns", () => {
      for (const key of ["rolldownOptions", "rollupOptions"] as const) {
        const merged = mergeFarmProductionViteConfig(
          clientConfig,
          {
            build: {
              [key]: {
                input: "/elsewhere/entry.js",
                output: {
                  codeSplitting: appGroups,
                  minify: { compress: false },
                  banner: "/* app */",
                  format: "cjs",
                  dir: "/elsewhere",
                  entryFileNames: "app.js",
                  chunkFileNames: "[name].js",
                  assetFileNames: "[name][extname]",
                  hashCharacters: "base36",
                  sourcemap: true,
                  sourcemapBaseUrl: "https://maps.invalid/",
                },
              },
            },
          },
          { clientOutput: true },
        );
        expect(merged.build?.rollupOptions?.input).toEqual({
          "farm-client": "/app/.farm/entry.js",
        });
        expect(merged.build?.rollupOptions?.output).toEqual({
          ...farmOutput,
          codeSplitting: appGroups,
          minify: { compress: false },
          banner: "/* app */",
        });
      }
    });

    it("keeps the server build's output Farm's own", () => {
      const merged = mergeFarmProductionViteConfig(clientConfig, {
        build: { rolldownOptions: { output: { codeSplitting: appGroups } } },
      });
      expect(merged.build?.rollupOptions?.output).toEqual(farmOutput);
    });

    it("rejects an array of outputs", () => {
      expect(() =>
        mergeFarmProductionViteConfig(
          clientConfig,
          { build: { rollupOptions: { output: [{}, {}] } } },
          { clientOutput: true },
        ),
      ).toThrow(/one client output/);
    });
  });
});
