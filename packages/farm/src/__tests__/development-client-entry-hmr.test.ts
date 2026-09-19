// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close().catch(() => {})));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) => fs.rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

async function createProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-client-entry-hmr-"));
  temporaryRoots.add(root);

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  for (const dependency of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", dependency)),
      path.join(root, "node_modules", dependency),
      "junction",
    );
  }
  // The entry module imports @farm.js/core/client, so transforming it needs
  // the package resolvable from the fixture root.
  await fs.symlink(
    await fs.realpath(packageRoot),
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `import React from "react";
export default function Layout({ children }) {
  return <>{children}</>;
}`,
  );

  return root;
}

describe("development client entry HMR teardown", () => {
  it("awaits plugin close and destroys the router on entry dispose", async () => {
    const root = await createProject();
    const server = await createServer({
      root,
      images: { provider: "none" },
      // Transforming /@farm/client normally starts dependency discovery, and
      // Vite's close() deadlocks while that scan is in flight (#1263). This
      // test only asserts the transformed entry source, so discovery is
      // disabled rather than raced.
      vite: { optimizeDeps: { noDiscovery: true, include: [] } },
    } as never);
    servers.add(server);
    await server.listen(0);
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    const response = await fetch(`http://localhost:${address.port}/@farm/client`);
    expect(response.status).toBe(200);
    const code = await response.text();

    // The dispose hook must return the close promise so Vite finishes the old
    // runtime before evaluating the new module, and must destroy the router so
    // entry reloads do not stack popstate/beforeunload listeners.
    expect(code).toContain("await farmClientRuntime.close('hmr')");
    expect(code).toContain("spaRouter.destroy()");
    expect(code).not.toContain("void farmClientRuntime.close");
  }, 60_000);
});
