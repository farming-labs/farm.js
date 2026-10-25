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

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

async function startApp(): Promise<{ root: string; origin: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-api-deps-"));
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
  // route -> lib/projects -> lib/store: edits two levels down must reach the route.
  await writeModule(root, "src/lib/store.ts", `export const label = "first";\n`);
  await writeModule(
    root,
    "src/lib/projects.ts",
    `import { label } from "./store";
export const describe = () => label;\n`,
  );
  await writeModule(
    root,
    "src/app/api/projects/route.ts",
    `import { describe } from "../../../lib/projects";
export function GET() { return Response.json({ label: describe() }); }`,
  );
  await writeModule(
    root,
    "src/app/api/health/route.ts",
    `export function GET() { return Response.json({ ok: true }); }`,
  );

  const server = await createServer({ root, images: { provider: "none" } });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");

  return { root, origin: `http://localhost:${address.port}` };
}

const read = async (url: string) => (await fetch(url)).json();

describe("development API routes and the modules they import", () => {
  it("serve an edit to an imported module without a restart", async () => {
    const { root, origin } = await startApp();
    expect(await read(`${origin}/api/projects`)).toEqual({ label: "first" });

    await writeModule(root, "src/lib/store.ts", `export const label = "second";\n`);
    await vi.waitFor(
      async () => expect(await read(`${origin}/api/projects`)).toEqual({ label: "second" }),
      { timeout: 10_000, interval: 100 },
    );

    // The direct import too, and routes that import neither keep answering.
    await writeModule(
      root,
      "src/lib/projects.ts",
      `import { label } from "./store";
export const describe = () => label + "!";\n`,
    );
    await vi.waitFor(
      async () => expect(await read(`${origin}/api/projects`)).toEqual({ label: "second!" }),
      { timeout: 10_000, interval: 100 },
    );
    expect(await read(`${origin}/api/health`)).toEqual({ ok: true });
  }, 60_000);
});
