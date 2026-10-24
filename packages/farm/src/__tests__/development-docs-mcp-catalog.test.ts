// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { _listFarmRegisteredMCPServers } from "../mcp-catalog";
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
  agent = "{ llmsTxt: { full: false } }",
): Promise<{ origin: string; server: ViteDevServer }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-docs-mcp-catalog-"));
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
  // A docs runtime like @farming-labs/farmjs: it knows its MCP route, name, and version.
  const adapterServer = path.join(root, "docs-adapter/server.mjs");
  await writeModule(
    root,
    "docs-adapter/server.mjs",
    `export function createFarmDocsRuntimeHandler(_config, options) {
  options.registerMCPServer?.({
    name: "Fixture Docs",
    version: "0.2.121",
    title: "Fixture Docs",
    path: "/api/docs/mcp",
    protocolVersions: ["2025-06-18"],
  });
  return async (request) =>
    new URL(request.url).pathname === "/api/docs/mcp" ? Response.json({ mcp: true }) : null;
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
  // The docs MCP is not an API route, so the API's public path never moves it.
  api: { basePath: "/v1" },
  agent: ${agent},
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

  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return { origin: `http://localhost:${address.port}`, server };
}

describe("development AI catalog for a docs runtime's MCP endpoint", () => {
  it("lists the endpoint the docs runtime registers, and drops it when the server closes", async () => {
    const { origin, server } = await startDocsApp();

    const catalog = await fetch(`${origin}/.well-known/ai-catalog.json`);
    expect(catalog.status).toBe(200);
    const { entries } = await catalog.json();
    expect(entries).toEqual([
      expect.objectContaining({
        identifier: "urn:air:localhost:mcp:fixture-docs",
        url: `${origin}/api/docs/mcp/server-card`,
        displayName: "Fixture Docs",
        version: "0.2.121",
      }),
    ]);

    const card = await fetch(entries[0].url);
    expect(card.status).toBe(200);
    expect(await card.json()).toMatchObject({
      name: "localhost/fixture-docs",
      remotes: [
        {
          type: "streamable-http",
          url: `${origin}/api/docs/mcp`,
          supportedProtocolVersions: ["2025-06-18"],
        },
      ],
    });
    // The endpoint itself is still the docs runtime's.
    expect(await (await fetch(`${origin}/api/docs/mcp`)).json()).toEqual({ mcp: true });

    const llms = await (await fetch(`${origin}/llms.txt`)).text();
    expect(llms).toContain("## MCP");
    expect(llms).toContain(`- [Fixture Docs](${origin}/api/docs/mcp)`);

    await server.close();
    servers.delete(server);
    expect(_listFarmRegisteredMCPServers()).toEqual([]);
  }, 60_000);

  it("serves nothing with agent.aiCatalog false", async () => {
    const { origin } = await startDocsApp("{ aiCatalog: false, llmsTxt: { full: false } }");
    expect((await fetch(`${origin}/.well-known/ai-catalog.json`)).status).toBe(404);
    expect(await (await fetch(`${origin}/llms.txt`)).text()).not.toContain("## MCP");
  }, 60_000);
});
