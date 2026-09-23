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

describe("development markdown-source middleware ordering", () => {
  it("runs app middleware before serving raw markdown page sources", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-md-middleware-"));
    temporaryRoots.add(root);

    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", "react")),
      path.join(root, "node_modules", "react"),
      "junction",
    );
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", "react-dom")),
      path.join(root, "node_modules", "react-dom"),
      "junction",
    );
    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await fs.writeFile(
      path.join(root, "farm.config.ts"),
      `export default {
  middleware: [
    {
      matcher: "/private/:path*",
      handler() {
        return new Response("sign-in required", {
          status: 401,
          headers: { "x-markdown-guard": "yes" },
        });
      },
    },
  ],
};`,
    );
    await writeModule(
      root,
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) {
  return <>{children}</>;
}`,
    );
    await writeModule(
      root,
      "src/app/private/notes/page.md",
      `# Private notes\n\nprivate-notes-source\n`,
    );
    await writeModule(root, "src/app/open/page.md", `# Open notes\n\nopen-notes-source\n`);

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    // A middleware guard on the route must also cover its raw .md source.
    const guardedResponse = await fetch(`${origin}/private/notes.md`);
    expect(guardedResponse.status).toBe(401);
    expect(guardedResponse.headers.get("x-markdown-guard")).toBe("yes");
    await expect(guardedResponse.text()).resolves.not.toContain("private-notes-source");

    // Routes outside every matcher keep serving their markdown source.
    const openResponse = await fetch(`${origin}/open.md`);
    expect(openResponse.status).toBe(200);
    expect(openResponse.headers.get("content-type")).toContain("text/markdown");
    await expect(openResponse.text()).resolves.toContain("open-notes-source");
  }, 30_000);
});
