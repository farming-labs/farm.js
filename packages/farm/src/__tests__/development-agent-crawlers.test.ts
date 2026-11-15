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

async function startApp(config: string, files: Record<string, string> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-crawlers-"));
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
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default { images: { provider: "none" }, ${config} };`,
  );
  await writeModule(
    root,
    "src/app/layout.tsx",
    `import React from "react";
export const metadata = { title: "Acme", metadataBase: new URL("https://acme.test") };
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

/** The docs engine stays on with its own robots.txt, so every test also checks precedence over it. */
const DOCS = `docs: { enabled: true, entry: "/docs", contentDir: "docs", adapter: false }`;
const DOCS_PAGE = { "docs/page.md": "# Docs\n\nWelcome.\n" };

describe("development agent crawler policy", () => {
  it("serves agent.crawlers ahead of the docs engine", async () => {
    // No robots.ts, so the dotted path also has to stay on the renderer instead
    // of falling through to Vite's static pipeline.
    const origin = await startApp(
      `agent: { crawlers: { search: "allow", training: "block" } }, ${DOCS}`,
      {
        ...DOCS_PAGE,
        "src/app/sitemap.ts": `export default () => [{ url: "https://acme.test/" }];`,
      },
    );

    const robots = await fetch(`${origin}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(robots.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const robotsText = await robots.text();
    expect(robotsText).not.toContain("@farming-labs/docs");
    expect(robotsText).toContain("User-agent: OAI-SearchBot\n");
    expect(robotsText).toContain("User-agent: Bytespider\nDisallow: /\n");
    expect(
      robotsText.endsWith("User-agent: *\nAllow: /\n\nSitemap: https://acme.test/sitemap.xml\n"),
    ).toBe(true);
    // The docs engine keeps its pages.
    expect((await fetch(`${origin}/docs`)).status).toBe(200);
  }, 120_000);

  it("lets a root robots.ts win over agent.crawlers", async () => {
    const origin = await startApp(`agent: { crawlers: { training: "block" } }, ${DOCS}`, {
      ...DOCS_PAGE,
      "src/app/robots.ts": `export default { rules: { userAgent: "*", disallow: "/private/" } };`,
    });

    const robots = await fetch(`${origin}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(await robots.text()).toBe("User-agent: *\nDisallow: /private/\n");
  }, 120_000);

  it("lets a public robots.txt win over agent.crawlers", async () => {
    const origin = await startApp(`agent: { crawlers: { training: "block" } }, ${DOCS}`, {
      ...DOCS_PAGE,
      "public/robots.txt": "User-agent: *\nDisallow: /static/\n",
    });

    const robots = await fetch(`${origin}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(await robots.text()).toBe("User-agent: *\nDisallow: /static/\n");
  }, 120_000);
});
