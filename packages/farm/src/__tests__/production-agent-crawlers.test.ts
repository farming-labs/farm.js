// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("production agent crawler policy", () => {
  it("serves agent.crawlers ahead of the docs engine", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-crawlers-"));
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
      const app = path.join(root, "src", "app");
      await fs.mkdir(path.join(app, "docs"), { recursive: true });
      await fs.writeFile(
        path.join(app, "layout.tsx"),
        [
          'export const metadata = { title: "Acme", metadataBase: new URL("https://acme.test") };',
          "export default function Layout({ children }) { return <main>{children}</main>; }",
        ].join("\n"),
      );
      await fs.writeFile(
        path.join(app, "page.tsx"),
        "export default function Page() { return <p>home</p>; }",
      );
      await fs.writeFile(
        path.join(app, "sitemap.ts"),
        'export default () => [{ url: "https://acme.test/" }];',
      );
      await fs.writeFile(
        path.join(app, "docs", "page.md"),
        "---\ntitle: Documentation\n---\n# Documentation\n",
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          deploy: { target: "vercel" },
          agent: { crawlers: { search: "allow", training: "block" } },
          // The docs engine keeps its own robots.txt on; the generated file takes the path.
          docs: {
            adapter: false,
            entry: "/docs",
            contentDir: "src/app/docs",
            nav: { title: "Acme docs" },
          },
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

      const robots = await handler.fetch(new Request("https://acme.test/robots.txt"));
      expect(robots.status).toBe(200);
      expect(robots.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      const robotsText = await robots.text();
      expect(robotsText).not.toContain("@farming-labs/docs");
      expect(robotsText).toContain(
        "User-agent: OAI-SearchBot\nUser-agent: ChatGPT-User\nUser-agent: Claude-SearchBot\n",
      );
      expect(robotsText).toContain("User-agent: Bytespider\nDisallow: /\n");
      // The sitemap URL comes from metadataBase, not the request's host.
      expect(
        robotsText.endsWith("User-agent: *\nAllow: /\n\nSitemap: https://acme.test/sitemap.xml\n"),
      ).toBe(true);

      const head = await handler.fetch(
        new Request("https://other.test/robots.txt", { method: "HEAD" }),
      );
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      const post = await handler.fetch(
        new Request("https://acme.test/robots.txt", { method: "POST" }),
      );
      expect(post.status).toBe(405);

      // Docs pages still come from the docs engine.
      const docs = await handler.fetch(new Request("https://acme.test/docs"));
      expect(docs.status).toBe(200);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
