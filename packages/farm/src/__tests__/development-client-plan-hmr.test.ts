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
    // The test runs the update hook itself after each write. A watched file would also run it
    // whenever the watcher reports the write, which can be after the test's next write starts.
    server.watcher.unwatch(counter);
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
      context: Pick<HmrContext, "file" | "server" | "modules"> & Partial<Pick<HmrContext, "read">>,
    ) => Promise<unknown>;
    const hotUpdate = (read?: HmrContext["read"]) =>
      handleHotUpdate({
        file: counter,
        server,
        modules: [...(server.moduleGraph.getModulesByFile(counter) ?? [])],
        ...(read ? { read } : {}),
      });
    // An edit inside the component (its markup) keeps everything a plan reads, so the plan
    // stays as it is and Vite updates the module in place without a replan.
    await fs.writeFile(
      counter,
      (await fs.readFile(counter, "utf8")).replace("count {count}", "n {count}"),
    );
    await hotUpdate();
    expect(computeClientManifest).not.toHaveBeenCalled();
    await requestPlanReaders();
    expect(computeClientManifest).not.toHaveBeenCalled();

    // An editor that saves in place empties the file first, and the watcher can report the edit
    // then. Vite's read() returns once the new content lands, so the check sees the saved file.
    const saved = (await fs.readFile(counter, "utf8")).replace("n {count}", "clicks {count}");
    await fs.writeFile(counter, "");
    await hotUpdate(async () => {
      await fs.writeFile(counter, saved);
      return saved;
    });
    expect(computeClientManifest).not.toHaveBeenCalled();
    await requestPlanReaders();
    expect(computeClientManifest).not.toHaveBeenCalled();

    // A deferred strategy keeps the component a client boundary but changes the plan's island.
    await fs.writeFile(
      counter,
      (await fs.readFile(counter, "utf8")).replace(
        "export function Counter",
        'export const island = "idle";\nexport function Counter',
      ),
    );
    await hotUpdate();
    expect(computeClientManifest).toHaveBeenCalledTimes(1);

    // The page and the manifest module read the plan the edit already rebuilt.
    await requestPlanReaders();
    expect(computeClientManifest).toHaveBeenCalledTimes(1);
  }, 60_000);
});
