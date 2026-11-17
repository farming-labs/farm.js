// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

/**
 * A page, a layout, or `generateMetadata` can throw a `Response`: the routing docs treat a thrown
 * 3xx as a redirect, and development sends any thrown Response as it is. The production page
 * renderer had no branch for one, so a thrown 302 answered the generic 500 page and a thrown 401
 * lost its body and WWW-Authenticate.
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

const redirect = `new Response(null, { status: 302, headers: { Location: "/target" } })`;

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-page-thrown-response-"));
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
    "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false };`,
    "src/app/layout.tsx":
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
    "src/app/target/page.tsx": "export default function Target() { return <main>target</main>; }",
    "src/app/page-redirect/page.tsx": `export default async function Page() { throw ${redirect}; }`,
    "src/app/layout-redirect/layout.tsx": `export default function Layout() { throw ${redirect}; }`,
    "src/app/layout-redirect/page.tsx": "export default function Page() { return <main>x</main>; }",
    "src/app/metadata-redirect/page.tsx": `export async function generateMetadata() { throw ${redirect}; }
export default function Page() { return <main>x</main>; }`,
    "src/app/unauthorized/page.tsx": `export default function Page() {
  throw new Response("sign in first", { status: 401, headers: { "WWW-Authenticate": "Basic", "X-Reason": "auth" } });
}`,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

describe("a Response thrown while a page renders in production", () => {
  it("answers the request as it is", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    try {
      for (const pathname of ["/page-redirect", "/layout-redirect", "/metadata-redirect"]) {
        const response = await fetch(`${server.origin}${pathname}`, { redirect: "manual" });
        expect(response.status, pathname).toBe(302);
        expect(response.headers.get("location"), pathname).toBe("/target");
      }

      const unauthorized = await fetch(`${server.origin}/unauthorized`, { redirect: "manual" });
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get("www-authenticate")).toBe("Basic");
      expect(unauthorized.headers.get("x-reason")).toBe("auth");
      expect(await unauthorized.text()).toBe("sign in first");
    } finally {
      await server.stop();
    }
  }, 240_000);
});
