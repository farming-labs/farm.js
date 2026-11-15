// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
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

async function writeModule(root: string, relativePath: string, source: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
  return filePath;
}

async function startApp(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-watcher-"));
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
    `export default { images: { provider: "none" }, telemetry: false };`,
  );
  await writeModule(
    root,
    "src/app/layout.tsx",
    `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
  );
  for (const [relativePath, source] of Object.entries(files)) {
    await writeModule(root, relativePath, source);
  }

  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return { root: server.config.root, server, origin: `http://localhost:${address.port}` };
}

describe("development watcher recovery", () => {
  it("keeps browser HMR callbacks out of server environment transforms", async () => {
    const { server } = await startApp({
      "src/app/page.tsx": "export default function Page() { return null; }",
      "src/app/counter.tsx": '"use client"; export default function Counter() { return null; }',
    });
    const serverModule = await server.environments.ssr.transformRequest("/src/app/counter.tsx");
    const clientModule = await server.environments.client.transformRequest("/src/app/counter.tsx");
    expect(serverModule?.code).not.toContain("import.meta.hot");
    expect(serverModule?.code).not.toContain("$RefreshReg$");
    // React Fast Refresh owns client component updates; Farm must not also
    // re-render the module's default export as the page root.
    expect(clientModule?.code).toContain("validateRefreshBoundaryAndEnqueueUpdate");
    expect(clientModule?.code).not.toContain("__FARM_REACT_ROOT__");
  });

  it("renders a page once its missing import is created, without touching the page", async () => {
    const { root, server, origin } = await startApp({
      "src/app/page.tsx": `import React from "react";
import { Greeting } from "./greeting";
export default function Page() { return <main><Greeting /></main>; }`,
    });

    const failed = await fetch(origin);
    expect(failed.status).toBe(500);
    await failed.text();

    const created = await writeModule(
      root,
      "src/app/greeting.tsx",
      `import React from "react";
export function Greeting() { return <p>created later</p>; }`,
    );
    server.watcher.emit("add", created);

    const recovered = await fetch(origin);
    expect(await recovered.text()).toContain("created later");
    expect(recovered.status).toBe(200);
  });

  it("regenerates route module types when a layout, loading or error file is added", async () => {
    const { root, server } = await startApp({
      "src/app/page.tsx": `import React from "react";
export default function Page() { return <main>home</main>; }`,
    });
    const routeTypes = path.join(root, "src/farm.d.ts");
    await vi.waitFor(async () => expect(await fs.readFile(routeTypes, "utf8")).toContain('"/"'));
    expect(await fs.readFile(routeTypes, "utf8")).not.toContain('"/dashboard"');

    const layout = await writeModule(
      root,
      "src/app/dashboard/layout.tsx",
      `import React from "react";
export default function Layout({ children }) { return <section>{children}</section>; }`,
    );
    server.watcher.emit("add", layout);

    await vi.waitFor(
      async () => expect(await fs.readFile(routeTypes, "utf8")).toContain('"/dashboard"'),
      { timeout: 5000 },
    );
  });
});
