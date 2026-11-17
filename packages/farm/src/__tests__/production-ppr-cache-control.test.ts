// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

/**
 * A page with `revalidate` is sent with `public, s-maxage=<revalidate>, stale-while-revalidate=300`
 * (server-rendering docs). A PPR page's shell headers replaced that with
 * `s-maxage=<revalidate>, stale-while-revalidate` (no `public`, and a stale-while-revalidate
 * without the value RFC 5861 requires), and a shell served from the cache without `revalidate`
 * had no Cache-Control at all, though the miss that stored it was public.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-ppr-cache-control-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false, experimental: { ppr: true } };`,
    "src/app/layout.tsx":
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
    "src/app/hourly/page.tsx": `export const experimental_ppr = true;
export const revalidate = 3600;
export default function Hourly() { return <main>hourly</main>; }`,
    "src/app/shell/page.tsx": `export const experimental_ppr = true;
export default function Shell() { return <main>shell</main>; }`,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

describe("a PPR page's Cache-Control in production", () => {
  it("is the documented shared policy on a miss and on a hit", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    try {
      for (const [pathname, policy] of [
        ["/hourly", "public, s-maxage=3600, stale-while-revalidate=300"],
        ["/shell", "public, s-maxage=60, stale-while-revalidate=300"],
      ] as const) {
        const miss = await fetch(`${server.origin}${pathname}`);
        expect(miss.headers.get("x-farm-ppr"), pathname).toBe("miss");
        expect(miss.headers.get("cache-control"), pathname).toBe(policy);
        await miss.arrayBuffer();

        const hit = await fetch(`${server.origin}${pathname}`);
        expect(hit.headers.get("x-farm-ppr"), pathname).toBe("hit");
        expect(hit.headers.get("cache-control"), pathname).toBe(policy);
        await hit.arrayBuffer();
      }
    } finally {
      await server.stop();
    }
  }, 240_000);
});
