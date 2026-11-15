// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

/**
 * `revalidatePath("/pricing")`, as the PPR docs show, clears the page's cached shell when the page
 * answers at a different public URL: below a basePath or in a non-default locale.
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

async function serveApp(
  config: Record<string, unknown>,
  use: (request: (pathname: string, init?: RequestInit) => Promise<Response>) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-ppr-revalidate-path-"));
  roots.push(root);
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "src/app/layout.tsx":
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
    "src/app/pricing/page.tsx": `export const experimental_ppr = true;
export default function Pricing() { return <main>stamp:{String(Date.now() + Math.random())}</main>; }`,
    "src/app/api/revalidate/route.ts": `import { revalidatePath } from "@farm.js/core/cache";
export async function POST(request: Request) {
  await revalidatePath(new URL(request.url).searchParams.get("path")!);
  return Response.json({ ok: true });
}`,
    "src/messages/en.json": "{}",
    "src/messages/fr.json": "{}",
  };
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  const resolved = await resolveConfig(
    {
      root,
      srcDir: "src",
      telemetry: false,
      images: { provider: "none" },
      deploy: { target: "node-server" },
      experimental: { ppr: true },
      ...config,
    },
    "production",
  );
  await build(resolved, { root, preset: "node-server" });

  const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
  try {
    await use((pathname, init) =>
      fetch(`${server.origin}${pathname}`, { redirect: "manual", ...init }),
    );
  } finally {
    // Windows refuses to remove the output while the server still holds it as its cwd.
    await server.stop();
  }
}

describe("revalidatePath on a cached PPR shell", () => {
  it.each([
    ["below a basePath", { basePath: "/app" }, "/app/pricing"],
    [
      "in a non-default locale",
      { i18n: { locales: ["en", "fr"], defaultLocale: "en" } },
      "/fr/pricing",
    ],
  ] as const)(
    "clears it by the route path %s",
    async (_label, config, pagePath) => {
      await serveApp(config, async (request) => {
        const visit = async () => {
          const response = await request(pagePath);
          const html = await response.text();
          return {
            status: response.status,
            ppr: response.headers.get("x-farm-ppr"),
            stamp: html.match(/stamp:(?:<!-- -->)?([\d.]+)/)?.[1],
          };
        };
        const first = await visit();
        expect(first).toMatchObject({ status: 200, ppr: "miss" });
        expect(await visit()).toEqual({ ...first, ppr: "hit" });

        // The route path, as the docs show.
        const revalidated = await request("/api/revalidate?path=/pricing", { method: "POST" });
        expect(revalidated.status).toBe(200);
        const fresh = await visit();
        expect(fresh.ppr).toBe("miss");
        expect(fresh.stamp).not.toBe(first.stamp);

        // The public path still works too.
        await request(`/api/revalidate?path=${encodeURIComponent(pagePath)}`, { method: "POST" });
        expect((await visit()).ppr).toBe("miss");
      });
    },
    240_000,
  );
});
