// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer } from "./production-server";

/**
 * An `error.tsx` handles errors from the pages below it, and renders inside the layouts of its own
 * segment and those above it. Both runtimes rendered it inside every layout of the page instead,
 * so when a layout below the boundary threw, it threw again around the boundary and the request
 * fell through to Farm's generic 500 page, though `routing` promises that page only when no
 * boundary applies or the boundary itself fails.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];
const devServers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...devServers].map((server) => server.close()));
  devServers.clear();
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

const boundary = (name: string) =>
  `"use client";\nexport default function Boundary() { return <section>${name} boundary</section>; }`;

async function createApp(): Promise<string> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(packageRoot, ".tmp-error-boundary-layout-scope-")),
  );
  roots.push(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false };`,
    "src/app/layout.tsx":
      "export default function Root({ children }) { return <html><body><nav>root layout</nav>{children}</body></html>; }",
    "src/app/page.tsx": "export default function Home() { return <main>home</main>; }",
    "src/app/a/error.tsx": boundary("a"),
    "src/app/a/layout.tsx":
      "export default function A({ children }) { return <div>a layout {children}</div>; }",
    "src/app/a/b/layout.tsx":
      'export default function AB() { throw new Error("a/b layout failed"); }',
    "src/app/a/b/page.tsx": "export default function Page() { return <main>a/b page</main>; }",
    "src/app/c/error.tsx": boundary("c"),
    "src/app/c/d/layout.tsx":
      "export default function CD({ children }) { return <div>c/d layout {children}</div>; }",
    "src/app/c/d/page.tsx":
      'export default function Page() { throw new Error("c/d page failed"); }',
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

async function expectBoundaryScopes(origin: string): Promise<void> {
  // A layout below the boundary failed: the boundary renders in the layouts above it.
  const layoutError = await fetch(`${origin}/a/b`);
  const layoutErrorHtml = await layoutError.text();
  expect(layoutError.status).toBe(500);
  expect(layoutErrorHtml).toContain("a boundary");
  expect(layoutErrorHtml).toContain("a layout");
  expect(layoutErrorHtml).toContain("root layout");

  // A page failed: its boundary is not wrapped in the layout of a deeper segment.
  const pageError = await fetch(`${origin}/c/d`);
  const pageErrorHtml = await pageError.text();
  expect(pageError.status).toBe(500);
  expect(pageErrorHtml).toContain("c boundary");
  expect(pageErrorHtml).toContain("root layout");
  expect(pageErrorHtml).not.toContain("c/d layout");
}

describe("an error boundary's layouts", () => {
  it("are those at or above its segment in development", async () => {
    const server = await createServer({ root: await createApp() });
    devServers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    await expectBoundaryScopes(`http://localhost:${address.port}`);
  }, 120_000);

  it("are those at or above its segment in production", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    try {
      await expectBoundaryScopes(server.origin);
    } finally {
      await server.stop();
    }
  }, 240_000);
});
