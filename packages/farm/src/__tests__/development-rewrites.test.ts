// @vitest-environment node

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { defineIntegration } from "../integrations";
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

describe("development config rewrites", () => {
  it("uses rewrites after local page and API routes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-rewrites-"));
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
  rewrites: async () => [
    { source: "/local", destination: "/fallback" },
    { source: "/api/local", destination: "/api/fallback" },
    { source: "/legacy", destination: "/fallback" },
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
      "src/app/local/page.tsx",
      `import React from "react";
export default function Page() { return <main>local page</main>; }`,
    );
    await writeModule(
      root,
      "src/app/fallback/page.tsx",
      `import React from "react";
export default function Page() { return <main>fallback page</main>; }`,
    );
    await writeModule(
      root,
      "src/app/api/local/route.ts",
      `export function GET() { return Response.json({ source: "local" }); }`,
    );
    await writeModule(
      root,
      "src/app/api/fallback/route.ts",
      `export function GET() { return Response.json({ source: "fallback" }); }`,
    );

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    const localPage = await fetch(`${origin}/local`).then((response) => response.text());
    const fallbackPage = await fetch(`${origin}/legacy`).then((response) => response.text());
    const localApi = await fetch(`${origin}/api/local`).then((response) => response.json());

    expect(localPage).toContain("local page");
    expect(localPage).not.toContain("fallback page");
    expect(fallbackPage).toContain("fallback page");
    expect(localApi).toEqual({ source: "local" });
  }, 30_000);

  it("keeps the docs API ahead of a catch-all API rewrite, as production does", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-rewrites-docs-"));
    temporaryRoots.add(root);

    await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
    await fs.writeFile(
      path.join(root, "farm.config.ts"),
      `export default {
  docs: { enabled: true, entry: "/docs", contentDir: "docs", adapter: false },
  rewrites: async () => [{ source: "/api/:path*", destination: "/api/fallback" }],
};`,
    );
    await writeModule(root, "docs/guide.md", "# Guide\n\nRewritten routes.\n");
    await writeModule(
      root,
      "src/app/api/fallback/route.ts",
      `export function GET() { return Response.json({ source: "fallback" }); }`,
    );

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    const search = await fetch(`${origin}/api/docs?query=guide`);
    expect(search.status).toBe(200);
    expect(JSON.stringify(await search.json())).toContain("/docs/guide");
    expect(await fetch(`${origin}/api/other`).then((response) => response.json())).toEqual({
      source: "fallback",
    });
  }, 30_000);

  it("forwards rewrites to another origin, as production does", async () => {
    const upstream = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const text = `upstream ${req.method} ${req.url} ${body}`.trim();
      if (req.url?.startsWith("/zipped")) {
        res.setHeader("content-encoding", "gzip");
        res.end(gzipSync(text));
        return;
      }
      res.end(text);
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("No upstream");
    const upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`;

    try {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-rewrites-external-"));
      temporaryRoots.add(root);
      await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
      await writeModule(
        root,
        "src/app/api/local/route.ts",
        `export function GET() { return Response.json({ source: "local" }); }`,
      );

      const server = await createServer({
        root,
        images: { provider: "none" },
        rewrites: async () => [
          { source: "/api/:path*", destination: `${upstreamOrigin}/:path*` },
          { source: "/proxy/:path*", destination: `${upstreamOrigin}/:path*` },
        ],
        // An integration's request hook must not choke on the absolute destination.
        integrations: {
          cache: defineIntegration({ category: "cache", type: "rewrite-test", instance: {} }),
        },
      });
      servers.add(server);
      await server.listen(await getAvailablePort());
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Missing dev server address");
      const origin = `http://localhost:${address.port}`;

      const api = await fetch(`${origin}/api/items?page=2`, { method: "POST", body: "payload" });
      expect(api.status).toBe(200);
      expect(await api.text()).toBe("upstream POST /items?page=2 payload");
      const page = await fetch(`${origin}/proxy/about`);
      expect(await page.text()).toBe("upstream GET /about");
      // fetch() decodes the body, so the upstream's encoding headers must not reach the client.
      const zipped = await fetch(`${origin}/proxy/zipped`);
      expect(zipped.headers.get("content-encoding")).toBeNull();
      expect(await zipped.text()).toBe("upstream GET /zipped");
      // Rewrites stay a fallback: the app's own route still wins.
      expect(await fetch(`${origin}/api/local`).then((response) => response.json())).toEqual({
        source: "local",
      });
    } finally {
      await new Promise((resolve) => upstream.close(resolve));
    }
  }, 30_000);
});
