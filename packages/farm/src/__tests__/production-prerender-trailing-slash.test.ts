// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

/**
 * With `trailingSlash`, a page answers at one spelling and redirects the other with 308, in
 * development and production. A prerendered page is a static file, and Nitro's static handler
 * strips the trailing slash and tries the file and its index.html before the request reaches
 * Farm, so a node-server build answered both spellings with 200: two URLs for one page.
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

async function startApp(trailingSlash: boolean) {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-prerender-trailing-slash-"));
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
    "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false, trailingSlash: ${trailingSlash} };`,
    "src/app/layout.tsx":
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
    "src/app/page.tsx": `export const dynamic = "force-static";
export default function Home() { return <main>home</main>; }`,
    "src/app/about/page.tsx": `export const dynamic = "force-static";
export default function About() { return <main>about</main>; }`,
    "src/app/blog/[slug]/page.tsx": `export const dynamic = "force-static";
export function getStaticPaths() { return [{ slug: "one" }]; }
export default function Post({ params }) { return <main>{"post " + params.slug}</main>; }`,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  const config = await resolveConfig(
    { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
    "production",
  );
  await build(config, { root, preset: "node-server" });
  return startProductionServer(path.join(root, ".farm", ".output", "server"));
}

describe("a prerendered page in a node-server build", () => {
  it.each([
    [false, "/about", "/about/"],
    [true, "/about/", "/about"],
  ])(
    "with trailingSlash: %s answers %s and redirects %s to it",
    async (trailingSlash, canonical, other) => {
      const server = await startApp(trailingSlash);
      try {
        const page = await fetch(`${server.origin}${canonical}`, { redirect: "manual" });
        expect(page.status).toBe(200);
        expect(await page.text()).toContain("about");

        const redirected = await fetch(`${server.origin}${other}?ref=nav`, { redirect: "manual" });
        expect(redirected.status).toBe(308);
        expect(redirected.headers.get("location")).toBe(`${canonical}?ref=nav`);

        // A getStaticPaths page too, and the home page answers at "/".
        const post = trailingSlash ? "/blog/one/" : "/blog/one";
        const postOther = trailingSlash ? "/blog/one" : "/blog/one/";
        expect((await fetch(`${server.origin}${post}`, { redirect: "manual" })).status).toBe(200);
        const postRedirect = await fetch(`${server.origin}${postOther}`, { redirect: "manual" });
        expect(postRedirect.status).toBe(308);
        expect(postRedirect.headers.get("location")).toBe(post);
        expect((await fetch(`${server.origin}/`, { redirect: "manual" })).status).toBe(200);
      } finally {
        await server.stop();
      }
    },
    240_000,
  );
});
