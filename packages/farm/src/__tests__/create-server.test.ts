import { describe, expect, it } from "vitest";
import {
  createFarmClientOptimizeDepsConfig,
  FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE,
  mergeFarmViteConfig,
} from "../server/vite-config";

describe("mergeFarmViteConfig", () => {
  it("keeps Farm client runtimes in React's dependency optimizer generation", () => {
    expect(createFarmClientOptimizeDepsConfig()).toMatchObject({
      noDiscovery: true,
      holdUntilCrawlEnd: false,
      include: expect.arrayContaining([
        "react",
        "react-dom/client",
        "@farm.js/core/client",
        "@farm.js/core/plugin/client",
        "@farm.js/core/deferred",
        "@farm.js/core/deployment",
      ]),
    });
    expect(FARM_CLIENT_OPTIMIZE_DEPS_INCLUDE).toContain("react/jsx-dev-runtime");
  });

  it("preserves Farm plugins and dependency safeguards when user Vite config is merged", () => {
    const farmPlugin = { name: "farm:framework" };
    const userPlugin = { name: "app:plugin" };

    const merged = mergeFarmViteConfig(
      {
        plugins: [farmPlugin],
        server: { middlewareMode: false, port: 3000, strictPort: true },
        resolve: { dedupe: ["react", "react-dom"] },
        optimizeDeps: {
          noDiscovery: true,
          include: ["react"],
          exclude: ["lightningcss", "@tailwindcss/oxide"],
        },
        ssr: { noExternal: ["farm"] },
      },
      {
        plugins: [userPlugin],
        server: { port: 4100, strictPort: false },
        resolve: { dedupe: ["react-dom", "react-is"] },
        optimizeDeps: {
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
    expect(merged.optimizeDeps).toMatchObject({
      noDiscovery: true,
      include: ["react", "react-dom"],
      exclude: ["lightningcss", "@tailwindcss/oxide", "supports-color"],
    });
    expect(merged.ssr?.noExternal).toEqual(["farm", "app-runtime"]);
  });
});
