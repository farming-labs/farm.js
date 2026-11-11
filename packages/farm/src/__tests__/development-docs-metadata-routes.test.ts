// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

async function startDocsApp(
  docsConfig: string,
  files: Record<string, string> = {},
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-docs-metadata-"));
  temporaryRoots.add(root);

  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(root, "docs/guide.md", "---\ntitle: Guide\n---\n# Guide\n");
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default {
  docs: ${docsConfig},
  images: { provider: "none" },
};`,
  );
  await writeModule(
    root,
    "src/app/layout.tsx",
    `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
  );
  await writeModule(
    root,
    "src/app/page.tsx",
    `import React from "react";
export default function Page() { return <main>home</main>; }`,
  );
  for (const [relativePath, source] of Object.entries(files)) {
    await writeModule(root, relativePath, source);
  }

  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

describe("development docs and app metadata routes", () => {
  it("lets an app's own robots.ts take /robots.txt from the docs engine", async () => {
    const origin = await startDocsApp(
      `{ enabled: true, entry: "/docs", contentDir: "docs", adapter: false }`,
      {
        "src/app/robots.ts": `export default { rules: { userAgent: "*", disallow: "/private/" } };`,
      },
    );

    const robots = await fetch(`${origin}/robots.txt`);
    expect(robots.status).toBe(200);
    const robotsText = await robots.text();
    expect(robotsText).toContain("Disallow: /private/");
    expect(robotsText).not.toContain("@farming-labs/docs");

    // With no sitemap.ts, the docs engine keeps /sitemap.xml.
    const sitemap = await fetch(`${origin}/sitemap.xml`);
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("content-type")).toContain("application/xml");
    expect(await sitemap.text()).toContain("/docs/guide");
  }, 30_000);

  it("decides who owns an agent file on the route path, as production does", async () => {
    const origin = await startDocsApp(
      `{ enabled: true, entry: "/docs", contentDir: "docs", adapter: false }`,
      {
        "farm.config.ts": `export default {
  basePath: "/console",
  docs: { enabled: true, entry: "/docs", contentDir: "docs", adapter: false },
  images: { provider: "none" },
};`,
        "src/app/llms.ts": `export default function llms() { return "app llms"; }`,
      },
    );

    // The docs engine reads /llms.txt/ as /llms.txt; production gives both to the app's llms.ts.
    for (const pathname of ["/llms.txt", "/llms.txt/", "/console/llms.txt", "/console/llms.txt/"]) {
      const response = await fetch(`${origin}${pathname}`);
      expect(response.status, pathname).toBe(200);
      expect(await response.text(), pathname).toBe("app llms\n");
    }
    // The app has no robots.ts, so the docs engine keeps /robots.txt.
    expect(await (await fetch(`${origin}/robots.txt`)).text()).toContain("@farming-labs/docs");
  }, 30_000);

  it("serves the docs engine under basePath and links every page below it", async () => {
    const origin = await startDocsApp(`{}`, {
      "farm.config.ts": `export default {
  basePath: "/console",
  docs: { enabled: true, entry: "/docs", contentDir: "docs", adapter: false },
  images: { provider: "none" },
};`,
      "docs/page.md": "---\ntitle: Docs\n---\n# Docs\n",
    });
    const get = (pathname: string) => fetch(`${origin}${pathname}`);

    const page = await get("/console/docs/guide");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('href="/console/docs/guide"');
    expect(html).toContain('href="/console/llms.txt"');
    expect(html).toContain('const docsEntry="/console/docs"');
    expect(html).toContain(`property="og:url" content="${origin}/console/docs/guide"`);
    expect(html).not.toMatch(/href="\/(docs|llms\.txt)/);

    const markdown = await get("/console/docs/guide.md");
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await markdown.text()).toContain("URL: /console/docs/guide");

    const llms = await get("/console/llms.txt");
    expect(llms.status).toBe(200);
    const llmsText = await llms.text();
    expect(llmsText).toContain(`(${origin}/console/docs/guide.md)`);
    expect(llmsText).not.toContain(`${origin}/docs`);
    expect(await (await get("/console/sitemap.xml")).text()).toContain(
      `<loc>${origin}/console/docs/guide</loc>`,
    );
    expect(await (await get("/console/robots.txt")).text()).toContain(
      `Sitemap: ${origin}/console/sitemap.xml`,
    );

    // Search stays at /api/docs, as the app's API routes do, and links results below basePath.
    const results = (await (await get("/api/docs?query=guide")).json()) as Array<{ url: string }>;
    expect(results.map((result) => result.url)).toContain("/console/docs/guide");
    expect((await get("/console/api/docs?format=llms")).status).toBe(404);

    // Pages answer at the origin root too, and so do the docs.
    for (const pathname of ["/docs/guide", "/docs/guide.md", "/llms.txt"]) {
      expect((await get(pathname)).status, pathname).toBe(200);
    }
  }, 30_000);

  it("serves docs config without provider credentials and diagnostics without them", async () => {
    const secrets = ["ALGOLIA_ADMIN_SECRET", "OPENAI_SECRET"];
    const origin = await startDocsApp(`{
    enabled: true,
    entry: "/docs",
    contentDir: "docs",
    adapter: false,
    config: {
      search: { provider: "algolia", appId: "APP", indexName: "docs", adminApiKey: "ALGOLIA_ADMIN_SECRET" },
      ai: { enabled: true, apiKey: "OPENAI_SECRET" },
    },
  }`);

    const config = await fetch(`${origin}/api/docs?format=config`);
    expect(config.status).toBe(200);
    const configBody = await config.text();
    for (const secret of secrets) expect(configBody).not.toContain(secret);
    expect(JSON.parse(configBody)).toMatchObject({
      config: { search: { provider: "algolia", appId: "APP", adminApiKey: "[redacted]" } },
    });

    // Diagnostics stay available to the developer, still without credentials.
    const diagnostics = await fetch(`${origin}/api/docs?format=diagnostics`);
    expect(diagnostics.status).toBe(200);
    const diagnosticsBody = await diagnostics.text();
    for (const secret of secrets) expect(diagnosticsBody).not.toContain(secret);
  }, 30_000);
});
