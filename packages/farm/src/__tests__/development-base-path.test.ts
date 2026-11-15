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

async function startApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-base-path-"));
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
    `export default { basePath: "/app", images: { provider: "none" } };`,
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
export default function Page() { return <main>home page</main>; }`,
  );
  await writeModule(
    root,
    "src/app/about/page.tsx",
    `import React from "react";
export default function Page() { return <main>about page</main>; }`,
  );

  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

describe("development basePath routing", () => {
  it("renders pages and page data under the configured basePath", async () => {
    const origin = await startApp();

    for (const [pathname, text] of [
      ["/app", "home page"],
      ["/app/about", "about page"],
    ]) {
      const response = await fetch(`${origin}${pathname}`, { redirect: "manual" });
      expect(response.status, pathname).toBe(200);
      expect(await response.text(), pathname).toContain(text);
    }

    const trailingSlash = await fetch(`${origin}/app/`, { redirect: "manual" });
    expect(trailingSlash.status).toBe(308);
    expect(trailingSlash.headers.get("location")).toBe("/app");

    const pageData = await fetch(
      `${origin}/__farm/page-data?path=${encodeURIComponent("/app/about")}`,
      { headers: { Accept: "application/json", "X-Farm-SPA": "1" } },
    );
    expect(pageData.status).toBe(200);
    expect(await pageData.text()).toContain("about page");
  }, 30_000);
});
