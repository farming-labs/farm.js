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

async function startDocsAdapterApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-docs-body-"));
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
  // A docs runtime like @farming-labs/farmjs: it owns its MCP endpoint and declines the rest.
  const adapterServer = path.join(root, "docs-adapter/server.mjs");
  await writeModule(
    root,
    "docs-adapter/server.mjs",
    `export function createFarmDocsRuntimeHandler() {
  return async (request) => {
    if (new URL(request.url).pathname !== "/api/docs/mcp") return null;
    const body = await request.text();
    return Response.json({
      method: request.method,
      contentType: request.headers.get("content-type"),
      body,
    });
  };
}`,
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default {
  docs: {
    enabled: true,
    entry: "/docs",
    contentDir: "docs",
    adapter: { id: "test-docs", protocol: 1, server: ${JSON.stringify(adapterServer)}, react: "react" },
  },
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
  await writeModule(
    root,
    "src/app/api/echo/route.ts",
    `export async function POST(request: Request) {
  return Response.json({ body: await request.text() });
}`,
  );

  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

describe("development docs request body", () => {
  it("forwards a POST body to the docs runtime and keeps it for declined paths", async () => {
    const origin = await startDocsAdapterApp();
    const initialize = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {} },
    });

    const mcp = await fetch(`${origin}/api/docs/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: initialize,
    });
    expect(mcp.status).toBe(200);
    expect(await mcp.json()).toEqual({
      method: "POST",
      contentType: "application/json",
      body: initialize,
    });

    // The docs runtime declines this path, so the app's route still reads the body.
    const echo = await fetch(`${origin}/api/echo`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "still here",
    });
    expect(echo.status).toBe(200);
    expect(await echo.json()).toEqual({ body: "still here" });
  }, 30_000);
});
