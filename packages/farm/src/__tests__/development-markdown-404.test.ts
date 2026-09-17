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

describe("development markdown 404", () => {
  it("serves a Markdown error body to agents that request Markdown", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-404-"));
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

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    // A `.md` URL for a missing page: Markdown 404 body, not the HTML shell.
    const mdExtension = await fetch(`${origin}/missing.md`);
    expect(mdExtension.status).toBe(404);
    expect(mdExtension.headers.get("content-type")).toContain("text/markdown");
    const mdBody = await mdExtension.text();
    expect(mdBody).toContain("# Page not found");
    expect(mdBody).toContain("/missing.md");
    expect(mdBody.length).toBeGreaterThan(20);
    expect(mdBody).not.toContain("<html");

    // Accept: text/markdown on a missing path: same treatment.
    const acceptHeader = await fetch(`${origin}/missing`, {
      headers: { accept: "text/markdown" },
    });
    expect(acceptHeader.status).toBe(404);
    expect(acceptHeader.headers.get("content-type")).toContain("text/markdown");
    await expect(acceptHeader.text()).resolves.toContain("Page not found");

    // A normal browser 404 stays HTML.
    const htmlRequest = await fetch(`${origin}/missing`, {
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    expect(htmlRequest.status).toBe(404);
    expect(htmlRequest.headers.get("content-type")).toContain("text/html");
  }, 30_000);
});
