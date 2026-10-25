// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { registerFarmMCPServer } from "../mcp-catalog";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();
const disposers: Array<() => void> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

const PAGES = {
  "src/app/layout.tsx": `import React from "react";
export const metadata = { title: "Acme" };
export default function Layout({ children }) { return <>{children}</>; }`,
  "src/app/page.tsx": `import React from "react";
export const metadata = { title: "Home", description: "Acme builds tools." };
export default function Page() { return <main><h1>Home</h1><p>Welcome home.</p></main>; }`,
  "src/app/about/page.tsx": `import React from "react";
export const metadata = { title: "About us" };
export default function Page() { return <main><h1>About us</h1><p>We ship tools.</p></main>; }`,
  "src/app/blog/[slug]/page.tsx": `import React from "react";
export default function Page() { return <main>post</main>; }`,
  "src/app/drafts/page.tsx": `import React from "react";
export const metadata = { robots: { index: false } };
export default function Page() { return <main>drafts</main>; }`,
  "src/farm.routes.tsx": `import React from "react";
import { createRoute, defineRoutes, redirect } from "@farm.js/core";

export const Account = createRoute("/account", {
  guard() { redirect("/"); },
  component: () => <main>secret account</main>,
});

export default defineRoutes(() => [Account]);`,
};

async function startApp(config: string, files: Record<string, string> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-mcp-"));
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
  await fs.writeFile(
    path.join(root, "package.json"),
    '{"name":"acme-site","version":"3.1.0","private":true,"type":"module"}',
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default { images: { provider: "none" }, ${config} };`,
  );
  for (const [relativePath, source] of Object.entries({ ...PAGES, ...files })) {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, source);
  }

  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

function mcp(origin: string, method: string, params?: unknown) {
  return fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
}

async function call(origin: string, name: string, args: Record<string, unknown> = {}) {
  const response = await mcp(origin, "tools/call", { name, arguments: args });
  expect(response.status).toBe(200);
  return ((await response.json()) as { result: any }).result;
}

describe("development default MCP server", () => {
  it("serves read-only page tools at /mcp and lists them for discovery", async () => {
    const origin = await startApp("");

    const initialize = await mcp(origin, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(initialize.status).toBe(200);
    expect(((await initialize.json()) as any).result.serverInfo).toMatchObject({
      name: "acme-site",
      version: "3.1.0",
    });

    const listed = await call(origin, "list_pages");
    // Dynamic, noindex, and guarded pages are left out.
    expect(listed.structuredContent.pages.map((page: { path: string }) => page.path)).toEqual([
      "/",
      "/about",
    ]);

    const about = await call(origin, "read_page", { path: "/about" });
    expect(about.isError).toBeUndefined();
    expect(about.content[0].text).toContain("We ship tools.");

    for (const path of ["/account", "/drafts"]) {
      const hidden = await call(origin, "read_page", { path });
      expect(hidden.isError).toBe(true);
      expect(hidden.content[0].text).toContain("No public page");
    }

    // The page reader is anonymous: the caller's cookies never reach a page.
    const withCookie = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=secret" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "read_page", arguments: { path: "/" } },
      }),
    });
    expect(((await withCookie.json()) as any).result.content[0].text).toContain("Welcome home.");

    expect((await fetch(`${origin}/mcp`)).status).toBe(405);

    const catalog = await fetch(`${origin}/.well-known/ai-catalog.json`);
    expect(((await catalog.json()) as any).entries).toEqual([
      expect.objectContaining({ url: `${origin}/mcp/server-card`, displayName: "acme-site" }),
    ]);
    expect((await fetch(`${origin}/mcp/server-card`)).status).toBe(200);
    expect(await (await fetch(`${origin}/llms.txt`)).text()).toContain(`(${origin}/mcp)`);
    const manifest = (await (await fetch(`${origin}/.well-known/farmjs.json`)).json()) as any;
    expect(manifest.mcp.servers).toEqual([
      expect.objectContaining({
        path: "/mcp",
        authorization: "none",
        tools: [
          expect.objectContaining({ name: "list_pages" }),
          expect.objectContaining({ name: "search_pages" }),
          expect.objectContaining({ name: "read_page" }),
        ],
      }),
    ]);
  }, 120_000);

  it("serves and reads pages below the base path", async () => {
    const origin = await startApp(`basePath: "/base"`);
    const response = await fetch(`${origin}/base/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read_page", arguments: { path: "/about" } },
      }),
    });
    const { result } = (await response.json()) as { result: any };
    expect(result.content[0].text).toContain("We ship tools.");
    const catalog = (await (
      await fetch(`${origin}/base/.well-known/ai-catalog.json`)
    ).json()) as any;
    expect(catalog.entries).toEqual([
      expect.objectContaining({ url: `${origin}/base/mcp/server-card` }),
    ]);
  }, 120_000);

  it("turns off with agent.mcp: false", async () => {
    const origin = await startApp("agent: { mcp: false }");
    expect((await mcp(origin, "ping")).status).toBe(404);
    expect((await fetch(`${origin}/.well-known/ai-catalog.json`)).status).toBe(404);
  }, 120_000);

  it("lets the app's own /mcp page route win", async () => {
    const origin = await startApp("", {
      "src/app/mcp/page.tsx": `import React from "react";
export default function Page() { return <main>our mcp page</main>; }`,
    });
    expect(await (await fetch(`${origin}/mcp`)).text()).toContain("our mcp page");
    expect((await fetch(`${origin}/.well-known/ai-catalog.json`)).status).toBe(404);
  }, 120_000);

  it("steps aside for an API route at /api/mcp and for @farm.js/mcp in plugins", async () => {
    const api = await startApp("", {
      "src/app/api/mcp/route.ts": `export function POST() { return Response.json({ own: true }); }`,
    });
    expect((await mcp(api, "ping")).status).toBe(404);
    expect(await (await fetch(`${api}/api/mcp`, { method: "POST" })).json()).toEqual({
      own: true,
    });

    const plugin = await startApp(`plugins: [{ name: "farm:api-mcp" }]`);
    expect((await mcp(plugin, "ping")).status).toBe(404);
  }, 120_000);

  it("steps aside for a registered server such as the docs engine's", async () => {
    const origin = await startApp("");
    disposers.push(
      registerFarmMCPServer({ name: "dev.farmjs/docs", version: "1.0.0", path: "/mcp" }),
    );
    expect((await mcp(origin, "ping")).status).toBe(404);
    const catalog = (await (await fetch(`${origin}/.well-known/ai-catalog.json`)).json()) as any;
    expect(catalog.entries).toEqual([expect.objectContaining({ displayName: "dev.farmjs/docs" })]);
  }, 120_000);
});
