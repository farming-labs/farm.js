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

async function writeApp(root: string, files: Record<string, string>): Promise<void> {
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
}

/** Builds the app for Vercel and returns its function's fetch handler. */
async function buildApp(root: string, options: Record<string, unknown>) {
  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      deploy: { target: "vercel" },
      agent: { crawlers: true, llmsTxt: true },
      ...options,
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
  const { default: handler } = await import(/* @vite-ignore */ pathToFileURL(functionPath).href);
  return handler as { fetch(request: Request): Promise<Response> };
}

describe("production default sitemap", () => {
  it("serves static public pages with lastmod and names them in robots.txt", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-sitemap-"));
    try {
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
        // Pages render with the layout's noindex unless they set their own robots.
        "src/app/staff/layout.tsx": [
          "export const metadata = { robots: { index: false } };",
          "export default function Layout({ children }) { return <section>{children}</section>; }",
        ].join("\n"),
        "src/app/staff/page.tsx": "export default function Page() { return <p>staff</p>; }",
        "src/app/staff/roster/page.tsx": [
          'export const metadata = { title: "Roster" };',
          "export default function Page() { return <p>roster</p>; }",
        ].join("\n"),
        "src/app/staff/careers/page.tsx": [
          'export const metadata = { title: "Careers", robots: { index: true } };',
          "export default function Page() { return <p>careers</p>; }",
        ].join("\n"),
      };
      await writeApp(root, files);
      const aboutModified = new Date("2026-10-01T12:00:00.000Z");
      await fs.utimes(path.join(root, "src/app/about/page.tsx"), aboutModified, aboutModified);

      const handler = await buildApp(root, {});

      // The URLs come from metadataBase, not the request's host.
      const sitemap = await handler.fetch(new Request("https://other.test/sitemap.xml"));
      expect(sitemap.status).toBe(200);
      expect(sitemap.headers.get("content-type")).toBe("application/xml; charset=utf-8");
      const xml = await sitemap.text();
      expect(locs(xml)).toEqual([
        "https://acme.test/",
        "https://acme.test/about",
        "https://acme.test/staff/careers",
      ]);
      expect(xml).toContain(
        "<loc>https://acme.test/about</loc>\n    <lastmod>2026-10-01T12:00:00.000Z</lastmod>",
      );

      const roster = await handler.fetch(new Request("https://acme.test/staff/roster"));
      expect(await roster.text()).toContain('name="robots" content="noindex"');
      // llms.txt links to metadataBase too, whatever host the request named.
      const llms = await (await handler.fetch(new Request("https://other.test/llms.txt"))).text();
      expect(llms).toContain("(https://acme.test/about.md)");
      expect(llms).not.toContain("other.test");
      // llms-full.txt still reads each page from this server.
      const full = await (
        await handler.fetch(new Request("https://other.test/llms-full.txt"))
      ).text();
      expect(full).toContain(
        "URL: https://acme.test/about.md\n\n# Acme\n\nSource: /about\n\nabout",
      );
      expect(full).not.toContain("other.test");
      expect(llms).toContain("[Careers]");
      expect(llms).not.toContain("/staff/roster");
      expect(llms).not.toMatch(/\/staff\)/);

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

  it("serves the home page's Markdown and the agent files under basePath", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-base-path-"));
    try {
      await writeApp(root, {
        "src/app/layout.tsx": [
          'export const metadata = { title: "Console", metadataBase: new URL("https://acme.test") };',
          "export default function Layout({ children }) { return <main>{children}</main>; }",
        ].join("\n"),
        "src/app/page.tsx": "export default function Page() { return <p>home body</p>; }",
        "src/app/about/page.tsx": "export default function Page() { return <p>about body</p>; }",
        "src/app/docs/intro/page.tsx": "export default function Page() { return <p>intro</p>; }",
      });
      const handler = await buildApp(root, { basePath: "/console" });
      const get = (pathname: string) => handler.fetch(new Request(`https://acme.test${pathname}`));

      // llms.txt links the home page to <basePath>/index.md, and that URL serves it.
      expect(await (await get("/console/llms.txt")).text()).toContain(
        "(https://acme.test/console/index.md)",
      );
      const home = await get("/console/index.md");
      expect(home.status).toBe(200);
      expect(home.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      expect(await home.text()).toContain("home body");
      expect(await (await get("/console/llms-full.txt")).text()).toContain(
        "URL: https://acme.test/console/index.md\n\n# Console\n\nSource: /console\n\nhome body",
      );
      // The other spellings of the home page's Markdown keep working.
      expect((await get("/console.md")).status).toBe(200);
      expect((await get("/index.md")).status).toBe(200);

      // The generated agent files answer inside the basePath and, as before, at the origin root.
      for (const pathname of ["/llms.txt", "/llms-full.txt", "/sitemap.xml", "/robots.txt"]) {
        expect((await get(`/console${pathname}`)).status, `/console${pathname}`).toBe(200);
        expect((await get(pathname)).status, pathname).toBe(200);
      }
      expect(locs(await (await get("/console/sitemap.xml")).text())).toContain(
        "https://acme.test/console/about",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
