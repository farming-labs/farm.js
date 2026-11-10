// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Vercel docs content", () => {
  it("renders the docs shell without access to the source checkout", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-vercel-docs-"));
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
      const source = path.join(root, "src");
      const guide = path.join(source, "app", "docs", "upgrading");
      await fs.mkdir(guide, { recursive: true });
      await fs.writeFile(
        path.join(source, "app", "layout.tsx"),
        "export default function Layout({ children }) { return <main>{children}</main>; }",
      );
      await fs.writeFile(
        path.join(source, "app", "globals.css"),
        ".farm-docs-globals { color: red; }\n",
      );
      await fs.writeFile(
        path.join(source, "app", "docs", "page.md"),
        "---\ntitle: Documentation\n---\n# Documentation\n\n[Upgrade guide](/docs/upgrading)\n",
      );
      await fs.writeFile(
        path.join(guide, "page.md"),
        [
          "---",
          "title: Upgrading",
          "description: Upgrade your Farm.js app.",
          "---",
          "# Upgrading",
          "",
          "## Upgrade packages",
          "",
          "```bash",
          "farm upgrade --latest --dry-run",
          "```",
          "",
          "| Deprecated | Replacement |",
          "| --- | --- |",
          "| `init` | `setup` |",
          "",
        ].join("\n"),
      );
      await fs.writeFile(
        path.join(source, "app", "sitemap.ts"),
        'export default function sitemap() { return [{ url: "https://farm.test/pricing" }]; }',
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          deploy: { target: "vercel" },
          agent: { llmsTxt: { title: "App index" } },
          docs: {
            adapter: false,
            entry: "/docs",
            contentDir: "src/app/docs",
            nav: { title: "Farm.js docs" },
          },
        },
        "production",
      );
      await build(config, { root, preset: "vercel" });

      // A local checkout must not hide missing or misplaced deployment assets.
      await fs.rename(source, path.join(root, "source-not-deployed"));
      const functionRoot = path.resolve(root, config.deploy.outputDir, "functions", "__nitro.func");
      const { default: handler } = await import(
        /* @vite-ignore */ pathToFileURL(path.join(functionRoot, "index.mjs")).href
      );
      for (const pathname of ["/docs", "/docs/upgrading"]) {
        const response = await handler.fetch(new Request(`https://farm.test${pathname}`));
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('id="nd-docs-layout"');
        expect(html).toContain('id="nd-sidebar"');
        // Every stylesheet the page links ships with the deployment, globals.css included.
        const stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(
          ([, href]) => href,
        );
        expect(stylesheets.length).toBeGreaterThan(0);
        const css = await Promise.all(
          stylesheets.map((href) =>
            fs.readFile(path.resolve(root, config.deploy.outputDir, "static", `.${href}`), "utf8"),
          ),
        );
        expect(css.join("")).toContain(".farm-docs-globals");
        if (pathname === "/docs/upgrading") {
          expect(html).toContain("Upgrade packages");
          expect(html).toContain("<table");
          expect(html).toContain("shiki");
        }
      }
      const markdown = await handler.fetch(new Request("https://farm.test/docs/upgrading.md"));
      expect(markdown.status).toBe(200);
      expect(markdown.headers.get("content-type")).toContain("text/markdown");
      expect(await markdown.text()).toContain("farm upgrade --latest --dry-run");
      // The app's own llms.txt takes /llms.txt; the docs engine keeps its well-known copy.
      const appLlms = await handler.fetch(new Request("https://farm.test/llms.txt"));
      expect(appLlms.status).toBe(200);
      expect((await appLlms.text()).startsWith("# App index\n")).toBe(true);
      // Ownership is decided on the route path, so /llms.txt/ is the app's too, as in dev.
      const appLlmsSlash = await handler.fetch(new Request("https://farm.test/llms.txt/"));
      expect((await appLlmsSlash.text()).startsWith("# App index\n")).toBe(true);
      const docsLlms = await handler.fetch(new Request("https://farm.test/.well-known/llms.txt"));
      expect(docsLlms.status).toBe(200);
      const docsLlmsText = await docsLlms.text();
      expect(docsLlmsText).not.toContain("# App index");
      // The docs engine's own index, which lists the fixture's docs pages.
      expect(docsLlmsText).toContain("Upgrading");
      expect(docsLlmsText).toContain("/docs/upgrading");
      // The docs engine also serves /llms-full.txt; agent.llmsTxt takes that path too.
      const appLlmsFull = await handler.fetch(new Request("https://farm.test/llms-full.txt"));
      expect(appLlmsFull.status).toBe(200);
      expect((await appLlmsFull.text()).startsWith("# App index\n")).toBe(true);
      // The app's own sitemap.ts takes /sitemap.xml from the docs engine.
      const appSitemap = await handler.fetch(new Request("https://farm.test/sitemap.xml"));
      expect(appSitemap.status).toBe(200);
      const appSitemapXml = await appSitemap.text();
      expect(appSitemapXml).toContain("<loc>https://farm.test/pricing</loc>");
      expect(appSitemapXml).not.toContain("/docs/upgrading");
      // With no robots.ts, the docs engine keeps /robots.txt.
      const docsRobots = await handler.fetch(new Request("https://farm.test/robots.txt"));
      expect(docsRobots.status).toBe(200);
      expect(await docsRobots.text()).toContain("# Generated by @farming-labs/docs.");

      const manifest = JSON.parse(
        await fs.readFile(
          path.join(functionRoot, "farm-docs-content", ".farm-docs-last-modified.json"),
          "utf8",
        ),
      );
      expect(manifest.pages["upgrading/page.md"]).toEqual(expect.any(String));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("serves the docs config's roots through the adapter's multi-root handler", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-vercel-docs-roots-"));
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
      const adapterDir = path.join(root, "node_modules", "fixture-docs-adapter");
      await fs.mkdir(adapterDir, { recursive: true });
      await fs.writeFile(
        path.join(adapterDir, "package.json"),
        JSON.stringify({
          name: "fixture-docs-adapter",
          type: "module",
          exports: { "./server": "./server.js", "./react": "./react.js" },
        }),
      );
      // Answers with the root it routed to and that root's page, read from its contentDir.
      await fs.writeFile(
        path.join(adapterDir, "server.js"),
        `import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export function createFarmDocsMultiRuntimeHandler(configs, options) {
  return async (request) => {
    const { pathname } = new URL(request.url);
    const config = [...configs]
      .sort((a, b) => b.docsPath.length - a.docsPath.length)
      .find((c) => pathname === c.docsPath || pathname.startsWith(c.docsPath + "/"));
    if (!config) return null;
    const page = readFileSync(resolve(options.rootDir, config.contentDir, "page.md"), "utf8");
    return Response.json({
      roots: configs.map((c) => c.docsPath),
      docsPath: config.docsPath,
      title: config.nav && config.nav.title,
      footer: typeof config.renderFooter === "function" ? config.renderFooter() : null,
      description: (config.metadata && config.metadata.description) || null,
      page,
    });
  };
}
`,
      );
      await fs.writeFile(
        path.join(adapterDir, "react.js"),
        "export function hydrateFarmDocs() {}\n",
      );
      await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
      // The roots are declared once, in the docs config; a function survives to the adapter.
      await fs.writeFile(
        path.join(root, "docs.config.ts"),
        `export default {
  entry: "docs",
  nav: { title: "Main" },
  roots: [
    { entry: "statewire/docs", nav: { title: "Statewire" }, renderFooter: () => "Statewire footer" },
  ],
};
`,
      );
      const source = path.join(root, "src");
      await fs.mkdir(path.join(source, "app", "docs"), { recursive: true });
      await fs.mkdir(path.join(source, "app", "statewire", "docs"), { recursive: true });
      await fs.writeFile(
        path.join(source, "app", "layout.tsx"),
        "export default function Layout({ children }) { return <main>{children}</main>; }",
      );
      await fs.writeFile(path.join(source, "app", "docs", "page.md"), "# Main docs\n");
      await fs.writeFile(
        path.join(source, "app", "statewire", "docs", "page.md"),
        "# Statewire docs\n",
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          deploy: { target: "vercel" },
          docs: {
            adapter: {
              id: "fixture-docs-adapter",
              protocol: 1,
              server: "fixture-docs-adapter/server",
              react: "fixture-docs-adapter/react",
            },
            entry: "/docs",
            // A serializable override for one root, applied over the docs config's root.
            roots: [{ entry: "/statewire/docs", metadata: { description: "From farm.config" } }],
          },
        },
        "production",
      );
      await build(config, { root, preset: "vercel" });

      await fs.rename(source, path.join(root, "source-not-deployed"));
      const functionRoot = path.resolve(root, config.deploy.outputDir, "functions", "__nitro.func");
      // The main root keeps its directory; an extra root's copy sits beside it, not inside it.
      await expect(
        fs.readFile(path.join(functionRoot, "farm-docs-content", "page.md"), "utf8"),
      ).resolves.toBe("# Main docs\n");
      await expect(
        fs.readFile(path.join(functionRoot, "farm-docs-roots", "0", "page.md"), "utf8"),
      ).resolves.toBe("# Statewire docs\n");
      const { default: handler } = await import(
        /* @vite-ignore */ pathToFileURL(path.join(functionRoot, "index.mjs")).href
      );
      const pages = await Promise.all(
        ["/docs", "/statewire/docs"].map(async (pathname) => {
          const response = await handler.fetch(new Request(`https://farm.test${pathname}`));
          expect(response.status).toBe(200);
          return response.json();
        }),
      );
      expect(pages).toEqual([
        {
          roots: ["/docs", "/statewire/docs"],
          docsPath: "/docs",
          title: "Main",
          footer: null,
          description: null,
          page: "# Main docs\n",
        },
        {
          roots: ["/docs", "/statewire/docs"],
          docsPath: "/statewire/docs",
          title: "Statewire",
          footer: "Statewire footer",
          description: "From farm.config",
          page: "# Statewire docs\n",
        },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
