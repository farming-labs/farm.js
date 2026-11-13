// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { hasFarmServerCacheConfig } from "../nitro/universal-build";
import { startProductionServer } from "./production-server";

/**
 * The production entry only bundled farm.config.ts when integrations,
 * observability, middleware, plugins or similar were configured. `cache` was
 * not on that list, so an app whose config only set `cache.adapter` built a
 * server that called configureFarmCache(undefined) and silently fell back to
 * per-process memory: revalidateTag/revalidatePath never reached other
 * instances and namespace, maxEntries and lease were ignored.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-cache-config-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app", "api", "cache"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  // Nothing but cache settings, so nothing else pulls the config module in.
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
const writes = (globalThis.__farmTestCacheWrites ??= []);
const entries = new Map();

export default {
  srcDir: "src",
  images: { provider: "none" },
  cache: {
    namespace: "config-namespace",
    adapter: {
      name: "config-adapter",
      async get(key) {
        return entries.get(key) ?? null;
      },
      async set(key, entry) {
        writes.push(key);
        entries.set(key, entry);
      },
      async delete(key) {
        entries.delete(key);
      },
    },
  },
};
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `export default function HomePage() { return <main>home</main>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "api", "cache", "route.ts"),
    `
import { getFarmDataCache, unstable_cache } from "@farm.js/core/cache";

const cachedValue = unstable_cache(async () => "cached", ["probe"]);

export async function GET() {
  const value = await cachedValue();
  return Response.json({
    value,
    adapter: getFarmDataCache().adapterName,
    writes: globalThis.__farmTestCacheWrites ?? [],
  });
}
`.trim(),
  );

  return root;
}

describe("production cache config", () => {
  it("bundles the config module only for server-side cache settings", () => {
    expect(hasFarmServerCacheConfig(undefined)).toBe(false);
    expect(hasFarmServerCacheConfig({})).toBe(false);
    // The browser cache adapter is a module path compiled into the client entry.
    expect(hasFarmServerCacheConfig({ client: { adapter: "./client-cache.ts" } })).toBe(false);
    expect(hasFarmServerCacheConfig({ namespace: "shop" })).toBe(true);
    expect(hasFarmServerCacheConfig({ maxEntries: 10 })).toBe(true);
    expect(hasFarmServerCacheConfig({ lease: false })).toBe(true);
    expect(
      hasFarmServerCacheConfig({
        adapter: { get: async () => null, set: async () => {}, delete: async () => {} },
      }),
    ).toBe(true);
  });

  it("uses cache.adapter and cache.namespace from farm.config.ts", async () => {
    const root = await createFixture();
    let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });

      production = await startProductionServer(path.join(root, ".farm", ".output", "server"));

      const response = await fetch(`${production.origin}/api/cache`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        value: string;
        adapter: string;
        writes: string[];
      };
      expect(body.value).toBe("cached");
      expect(body.adapter).toBe("config-adapter");
      expect(body.writes).toHaveLength(1);
      expect(body.writes[0]).toMatch(/^config-namespace:entry:/);
    } finally {
      await production?.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
