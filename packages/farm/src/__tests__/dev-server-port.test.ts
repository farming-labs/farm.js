// @vitest-environment node

import fs from "node:fs/promises";
import { createServer as createNodeServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { startDevServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      // Vite 8's optimizer can still be writing deps_temp_* after close() resolves.
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function freePort(): Promise<number> {
  const probe = createNodeServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("Missing probe address");
  return address.port;
}

async function createFixture(config?: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-server-port-"));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  if (config) await fs.writeFile(path.join(root, "farm.config.ts"), config);
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `import React from "react";
export default function Home() { return <main>port fixture</main>; }`,
  );
  return root;
}

function listeningPort(server: ViteDevServer) {
  const address = server.httpServer?.address();
  return address && typeof address === "object" ? address.port : undefined;
}

describe("farm dev --port", () => {
  it("keeps the requested port when Vite restarts the server", async () => {
    const port = await freePort();
    // The app's own port must lose to the flag, before and after a restart.
    const configured = await freePort();
    const root = await createFixture(
      `export default { vite: { server: { port: ${configured} } } };`,
    );
    const server = await startDevServer({ root, images: { provider: "none" } }, port);
    servers.add(server);
    expect(listeningPort(server)).toBe(port);

    // What an edited .env triggers: Vite rebuilds the server from its config.
    await server.restart();

    expect(listeningPort(server)).toBe(port);
    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("port fixture");
  }, 60_000);
});
