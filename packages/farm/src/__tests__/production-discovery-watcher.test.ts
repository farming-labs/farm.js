// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { loadFarmProductionVite } from "../build/production-vite";

it.each([false, true])(
  "disables production discovery watching with custom Vite config: %s",
  async (customVite) => {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-discovery-watcher-"));
    let discoveryServer: ViteDevServer | undefined;
    let injectedServerCalls = 0;
    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
      await fs.writeFile(path.join(root, "src", "app", "globals.css"), "body { margin: 0; }");
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        "export default function Page() { return <main>watcher fixture</main>; }",
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          ...(customVite
            ? {
                vite: {
                  server: { watch: { usePolling: true } },
                  plugins: [
                    {
                      name: "capture-discovery-server",
                      configureServer(server: ViteDevServer) {
                        discoveryServer = server;
                      },
                    },
                  ],
                },
              }
            : {}),
        },
        "production",
      );
      const runtime = await loadFarmProductionVite();
      await build(config, {
        root,
        preset: "node-server",
        productionVite: {
          ...runtime,
          createServer: async (inlineConfig) => {
            injectedServerCalls++;
            discoveryServer = await runtime.createServer(inlineConfig);
            return discoveryServer;
          },
        },
      });
      expect(discoveryServer).toBeDefined();
      expect(injectedServerCalls).toBe(customVite ? 0 : 1);
      expect(discoveryServer!.config.server.hmr).toBe(false);
      expect(discoveryServer!.config.server.watch).toBeNull();
      expect(discoveryServer!.watcher.getWatched()).toEqual({});
      expect(
        await fs.readFile(path.join(root, ".farm", ".output", "server", "index.mjs"), "utf8"),
      ).not.toBe("");
      if (customVite) expect(config.vite?.server?.watch).toEqual({ usePolling: true });
    } finally {
      await discoveryServer?.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
  120_000,
);
