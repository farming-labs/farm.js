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
const previousPreview = process.env.FARM_PREVIEW;

afterEach(async () => {
  if (previousPreview === undefined) delete process.env.FARM_PREVIEW;
  else process.env.FARM_PREVIEW = previousPreview;
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

async function startApp(agent: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-noindex-"));
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
    `export default { images: { provider: "none" }, agent: ${agent} };`,
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
    "src/app/api/ping/route.ts",
    `export function GET() { return Response.json({ ok: true }); }`,
  );

  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

async function robotsTags(origin: string): Promise<Record<string, string | null>> {
  const tags: Record<string, string | null> = {};
  for (const pathname of ["/", "/api/ping", "/@vite/client", "/missing"]) {
    const response = await fetch(`${origin}${pathname}`);
    await response.arrayBuffer();
    tags[pathname] = response.headers.get("x-robots-tag");
  }
  return tags;
}

describe("development agent.noindexPreviews", () => {
  it("marks every dev response while the environment says preview", async () => {
    process.env.FARM_PREVIEW = "0";
    const origin = await startApp("{ noindexPreviews: true }");

    expect(await robotsTags(origin)).toEqual({
      "/": null,
      "/api/ping": null,
      "/@vite/client": null,
      "/missing": null,
    });

    // `FARM_PREVIEW=1 farm dev`: pages, APIs, Vite's own modules, and 404s.
    process.env.FARM_PREVIEW = "1";
    const tag = "noindex, nofollow";
    expect(await robotsTags(origin)).toEqual({
      "/": tag,
      "/api/ping": tag,
      "/@vite/client": tag,
      "/missing": tag,
    });
  }, 60_000);

  it("leaves a preview alone without noindexPreviews", async () => {
    process.env.FARM_PREVIEW = "1";
    const origin = await startApp("{}");

    expect(Object.values(await robotsTags(origin))).toEqual([null, null, null, null]);
  }, 60_000);
});
