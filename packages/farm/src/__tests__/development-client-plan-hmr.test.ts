// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HmrContext, Plugin, ViteDevServer } from "vite";
import { RouteManager } from "../routing/route-manager";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function writeModule(root: string, relativePath: string, source: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
  return filePath;
}

describe("development client hydration plan across a client component edit", () => {
  it("builds the plan once for the edit instead of again on the next request", async () => {
    // The real path: macOS links the temp directory, and Vite's module ids use the target.
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-client-plan-hmr-")),
    );
    temporaryRoots.add(root);
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(
      await fs.realpath(packageRoot),
      path.join(root, "node_modules", "@farm.js", "core"),
      "junction",
    );
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
    const counter = await writeModule(
      root,
      "src/app/counter.tsx",
      `"use client";
import React, { useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>count {count}</button>;
}`,
    );
    await writeModule(
      root,
      "src/app/page.tsx",
      `import React from "react";
import { Counter } from "./counter";
export default function Page() { return <main><Counter /></main>; }`,
    );

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;
    const requestPlanReaders = async () => {
      expect((await fetch(origin)).status).toBe(200);
      await server.transformRequest("/@farm/manifest");
    };
    await requestPlanReaders();

    const computeClientManifest = vi.spyOn(
      RouteManager.prototype as unknown as { computeClientManifest(root: string): unknown },
      "computeClientManifest",
    );
    const farm = server.config.plugins.find((plugin) => plugin.name === "farm") as Plugin;
    const handleHotUpdate = farm.handleHotUpdate as (
      context: Pick<HmrContext, "file" | "server" | "modules">,
    ) => Promise<unknown>;
    // The edit keeps the component a client boundary, so the plan stays the same and Vite
    // updates the module in place.
    await handleHotUpdate({
      file: counter,
      server,
      modules: [...(server.moduleGraph.getModulesByFile(counter) ?? [])],
    });
    expect(computeClientManifest).toHaveBeenCalledTimes(1);

    // The page and the manifest module read the plan the edit already rebuilt.
    await requestPlanReaders();
    expect(computeClientManifest).toHaveBeenCalledTimes(1);
  }, 60_000);
});
