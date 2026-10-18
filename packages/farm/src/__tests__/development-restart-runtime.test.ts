// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
import { startDevServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close().catch(() => {})));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      // Vite 8's optimizer can still be writing deps_temp_* after close() resolves.
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

/**
 * A project whose plugin appends every runtime lifecycle call to a file, so
 * the assertions observe what the real config-loaded plugin saw.
 */
async function createProject(): Promise<{ root: string; events: () => Promise<string[]> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-restart-"));
  temporaryRoots.add(root);
  const log = path.join(root, "lifecycle.log");

  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(path.join(root, ".env"), "RESTART_FIXTURE=one\n");
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `import { appendFileSync } from "node:fs";
const record = (event) => appendFileSync(${JSON.stringify(log)}, event + "\\n");
export default {
  plugins: [
    {
      name: "lifecycle-recorder",
      setup() {
        record("setup");
        return {};
      },
      runtime: {
        start() {
          record("start");
        },
        close({ reason }) {
          record("close:" + reason);
        },
      },
    },
  ],
};`,
  );
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `import React from "react";
export default function Home() { return <main>restart fixture</main>; }`,
  );

  return {
    root,
    events: async () =>
      (await fs.readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean),
  };
}

const restarted = ["setup", "start", "close:dev-server-restart", "setup", "start"];

async function start(root: string) {
  const port = await getAvailablePort();
  const server = await startDevServer({ root, images: { provider: "none" } }, port);
  servers.add(server);
  return { server, port };
}

describe("development server restart", () => {
  it("restarts the plugin runtime with the server and still closes it once", async () => {
    const { root, events } = await createProject();
    const { server, port } = await start(root);
    expect(await events()).toEqual(["setup", "start"]);

    await server.restart();

    // Close for the restart, then a fresh setup and start for the new server.
    expect(await events()).toEqual(restarted);
    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("restart fixture");

    await server.close();

    // Farm's close is still installed: the runtime closes once, for the close.
    expect(await events()).toEqual([...restarted, "close:dev-server-closed"]);
    expect(server.httpServer?.listening).toBe(false);
  }, 60_000);

  it("still drains Vite's pending work before closing the restarted server", async () => {
    const { root } = await createProject();
    const { server } = await start(root);
    await server.restart();

    // Farm's close lets pending transforms finish before Vite cancels the
    // optimizer (#2052); Vite's own close cancels it straight away.
    const order: string[] = [];
    const client = server.environments.client;
    const optimizer = client.depsOptimizer!;
    const closeOptimizer = optimizer.close.bind(optimizer);
    optimizer.close = async () => {
      order.push("optimizer-close");
      await closeOptimizer();
    };
    const pending = (
      client as unknown as { _pendingRequests: Map<string, { request: Promise<void> }> }
    )._pendingRequests;
    const request = Promise.withResolvers<void>();
    pending.set("/held", { request: request.promise });
    void request.promise.finally(() => pending.delete("/held"));

    const closing = server.close();
    order.push("released");
    request.resolve();
    await closing;

    expect(order).toEqual(["released", "optimizer-close"]);
  }, 60_000);

  it("shuts down when the restarted HTTP server is closed directly", async () => {
    const { root, events } = await createProject();
    const { server } = await start(root);
    await server.restart();

    server.httpServer!.close();
    // close() is memoized, so this awaits the shutdown the close event began.
    await server.close();

    expect(await events()).toEqual([...restarted, "close:dev-server-closed"]);
  }, 60_000);

  it("restarts the plugin runtime when an edited .env restarts the server", async () => {
    const { root, events } = await createProject();
    const { server, port } = await start(root);

    await fs.writeFile(path.join(root, ".env"), "RESTART_FIXTURE=two\n");

    await vi.waitFor(async () => expect(await events()).toEqual(restarted), {
      timeout: 20_000,
      interval: 50,
    });
    // The runtime restarts before the new server listens; wait for the listener.
    await vi.waitFor(() => expect(server.httpServer?.listening).toBe(true), {
      timeout: 20_000,
      interval: 50,
    });
    expect((await fetch(`http://localhost:${port}/`)).status).toBe(200);

    await server.close();
    expect(await events()).toEqual([...restarted, "close:dev-server-closed"]);
  }, 60_000);
});
