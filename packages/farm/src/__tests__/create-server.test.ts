import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFarmClientOptimizeDepsConfig,
  createFarmClientOptimizeDepsEntries,
  createFarmSourceAlias,
  FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE,
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
