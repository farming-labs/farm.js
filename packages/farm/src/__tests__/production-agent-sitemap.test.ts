// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

describe("production default sitemap", () => {
  it("serves static public pages with lastmod and names them in robots.txt", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-sitemap-"));
    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      for (const name of ["react", "react-dom"]) {
        await fs.symlink(
          await fs.realpath(path.join(packageRoot, "node_modules", name)),
          path.join(root, "node_modules", name),
          "junction",
        );
      }
      await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
      const files: Record<string, string> = {
        "src/app/layout.tsx": [
          'export const metadata = { title: "Acme", metadataBase: new URL("https://acme.test") };',
          "export default function Layout({ children }) { return <main>{children}</main>; }",
        ].join("\n"),
        "src/app/page.tsx": "export default function Page() { return <p>home</p>; }",
        "src/app/about/page.tsx": "export default function Page() { return <p>about</p>; }",
        "src/app/blog/[slug]/page.tsx": "export default function Page() { return <p>post</p>; }",
        "src/app/drafts/page.tsx": [
          "export const metadata = { robots: { index: false } };",
          "export default function Page() { return <p>drafts</p>; }",
        ].join("\n"),
      };
      for (const [relativePath, source] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
        await fs.writeFile(path.join(root, relativePath), source);
      }
      const aboutModified = new Date("2026-10-01T12:00:00.000Z");
      await fs.utimes(path.join(root, "src/app/about/page.tsx"), aboutModified, aboutModified);

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          deploy: { target: "vercel" },
          agent: { crawlers: true },
        },
        "production",
      );
      await build(config, { root, preset: "vercel" });
      const functionPath = path.resolve(
        root,
        config.deploy.outputDir,
        "functions",
        "__nitro.func",
        "index.mjs",
      );
      const { default: handler } = await import(
        /* @vite-ignore */ pathToFileURL(functionPath).href
      );

      // The URLs come from metadataBase, not the request's host.
      const sitemap = await handler.fetch(new Request("https://other.test/sitemap.xml"));
      expect(sitemap.status).toBe(200);
      expect(sitemap.headers.get("content-type")).toBe("application/xml; charset=utf-8");
      const xml = await sitemap.text();
      expect(locs(xml)).toEqual(["https://acme.test/", "https://acme.test/about"]);
      expect(xml).toContain(
        "<loc>https://acme.test/about</loc>\n    <lastmod>2026-10-01T12:00:00.000Z</lastmod>",
      );

      const robots = await handler.fetch(new Request("https://acme.test/robots.txt"));
      expect(await robots.text()).toContain("Sitemap: https://acme.test/sitemap.xml");

      const post = await handler.fetch(
        new Request("https://acme.test/sitemap.xml", { method: "POST" }),
      );
      expect(post.status).toBe(405);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
