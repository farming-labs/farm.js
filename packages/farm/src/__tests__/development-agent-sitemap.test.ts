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

const PAGES = {
  "src/app/layout.tsx": `import React from "react";
export const metadata = { title: "Acme", metadataBase: new URL("https://acme.test") };
export default function Layout({ children }) { return <>{children}</>; }`,
  "src/app/page.tsx": `import React from "react";
export default function Page() { return <main>home</main>; }`,
  "src/app/about/page.tsx": `import React from "react";
export default function Page() { return <main>about</main>; }`,
  "src/app/blog/[slug]/page.tsx": `import React from "react";
export default function Page() { return <main>post</main>; }`,
  "src/app/drafts/page.tsx": `import React from "react";
export const metadata = { robots: { index: false } };
export default function Page() { return <main>drafts</main>; }`,
  "src/farm.routes.tsx": `import React from "react";
import { createRoute, defineRoutes, redirect } from "@farm.js/core";

export const Account = createRoute("/account", {
  guard() { redirect("/"); },
  component: () => <main>account</main>,
});

export const Team = createRoute("/team", { component: () => <main>team</main> });

export default defineRoutes(() => [Account, Team]);`,
};

async function startApp(config: string, files: Record<string, string> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-sitemap-"));
  temporaryRoots.add(root);

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default { images: { provider: "none" }, ${config} };`,
  );
  for (const [relativePath, source] of Object.entries({ ...PAGES, ...files })) {
    await writeModule(root, relativePath, source);
  }

  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

describe("development default sitemap", () => {
  it("lists static public pages with lastmod on metadataBase, with no config", async () => {
    const origin = await startApp("");

    const response = await fetch(`${origin}/sitemap.xml`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const xml = await response.text();
    // Dynamic, noindex, and guarded pages are left out.
    expect(locs(xml)).toEqual([
      "https://acme.test/",
      "https://acme.test/about",
      "https://acme.test/team",
    ]);
    expect(xml.match(/<lastmod>/g)?.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("turns off with agent.sitemap: false", async () => {
    const origin = await startApp("agent: { sitemap: false }");
    expect((await fetch(`${origin}/sitemap.xml`)).status).toBe(404);
  }, 120_000);

  it("lets a root sitemap.ts or a public sitemap.xml win", async () => {
    const owned = await startApp("", {
      "src/app/sitemap.ts": `export default () => [{ url: "https://acme.test/owned" }];`,
    });
    expect(locs(await (await fetch(`${owned}/sitemap.xml`)).text())).toEqual([
      "https://acme.test/owned",
    ]);

    const file = await startApp("", {
      "public/sitemap.xml":
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://acme.test/static</loc></url></urlset>',
    });
    expect(locs(await (await fetch(`${file}/sitemap.xml`)).text())).toEqual([
      "https://acme.test/static",
    ]);
  }, 120_000);

  it("names the sitemap in the robots.txt agent.crawlers serves", async () => {
    const origin = await startApp("agent: { crawlers: true }");
    expect(await (await fetch(`${origin}/robots.txt`)).text()).toContain(
      "Sitemap: https://acme.test/sitemap.xml",
    );
  }, 120_000);
});
