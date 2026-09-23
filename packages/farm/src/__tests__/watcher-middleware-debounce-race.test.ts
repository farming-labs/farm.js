// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { MiddlewareManager } from "../middleware/manager";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

const ROUTE_REFRESH_DEBOUNCE_MS = 50;
const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("dev-server route-refresh middleware debounce race", () => {
  let server: ViteDevServer;
  let reloadSpy: ReturnType<typeof vi.spyOn>;
  let root: string;
  let middlewarePath: string;
  let productsPagePath: string;
  let aboutPagePath: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-watcher-middleware-race-"));
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

    const writeModule = async (relativePath: string, source: string) => {
      const filePath = path.join(root, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, source);
    };
    await writeModule(
      "src/app/layout.tsx",
      `import React from "react";
export default function Layout({ children }) {
  return <>{children}</>;
}`,
    );
    await writeModule(
      "src/app/page.tsx",
      `import React from "react";
export default function Home() { return <main>home</main>; }`,
    );
    await writeModule(
      "src/app/products/page.tsx",
      `import React from "react";
export default function Products() { return <main>products</main>; }`,
    );
    await writeModule(
      "src/app/about/page.tsx",
      `import React from "react";
export default function About() { return <main>about</main>; }`,
    );

    // No middleware file exists initially, so the chokidar boot scan never
    // triggers a middleware reload and the spy starts from a clean slate.
    middlewarePath = path.join(root, "src", "app", "middleware.ts");
    productsPagePath = path.join(root, "src", "app", "products", "page.tsx");
    aboutPagePath = path.join(root, "src", "app", "about", "page.tsx");

    server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);

    // chokidar's boot scan schedules a 50 ms route-refresh debounce; let it (and
    // the 100 ms type-artifact debounce) fire and reset before any replay so the
    // first replayed event is not dropped by the `!routeRefreshScheduled` guard.
    await settle(10 * ROUTE_REFRESH_DEBOUNCE_MS);

    reloadSpy = vi.spyOn(MiddlewareManager.prototype, "reload").mockResolvedValue(undefined);
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await Promise.all([...servers].map((server) => server.close()));
    servers.clear();
    await Promise.all(
      [...temporaryRoots].map((dir) =>
        fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
      ),
    );
    temporaryRoots.clear();
  });

  // Before the fix this failed: the second event was dropped by the
  // `!routeRefreshScheduled` guard and the reload decision was made from the
  // first (page) event's closure-captured file, so reload() was never called.
  it("reloads middleware when a page 'add' is followed by a middleware 'add' inside the debounce window", async () => {
    reloadSpy.mockClear();
    server.watcher.emit("add", productsPagePath);
    server.watcher.emit("add", middlewarePath);
    await settle(5 * ROUTE_REFRESH_DEBOUNCE_MS);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("reloads middleware when middleware is the FIRST 'add' in the debounce window (control)", async () => {
    reloadSpy.mockClear();
    server.watcher.emit("add", middlewarePath);
    server.watcher.emit("add", productsPagePath);
    await settle(5 * ROUTE_REFRESH_DEBOUNCE_MS);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("does not reload middleware when only non-middleware app files are added (no over-eager reload)", async () => {
    reloadSpy.mockClear();
    server.watcher.emit("add", aboutPagePath);
    await settle(5 * ROUTE_REFRESH_DEBOUNCE_MS);
    expect(reloadSpy).not.toHaveBeenCalled();
  }, 30_000);

  it("resets the accumulated middleware flag after each debounce window", async () => {
    reloadSpy.mockClear();
    server.watcher.emit("add", middlewarePath);
    await settle(5 * ROUTE_REFRESH_DEBOUNCE_MS);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    reloadSpy.mockClear();
    // A subsequent window with only a page event must not reload middleware:
    // the previous window's flag must have been reset, not left sticky.
    server.watcher.emit("add", aboutPagePath);
    await settle(5 * ROUTE_REFRESH_DEBOUNCE_MS);
    expect(reloadSpy).not.toHaveBeenCalled();
  }, 30_000);
});
