// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
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
 * Middleware that sets headers and then calls `redirect()` or `notFound()` answers with those
 * headers in development, as in production. Development used to drop them.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const devServers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...devServers].map((server) => server.close()));
  devServers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

const files: Record<string, string> = {
  "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false };`,
  "src/app/layout.tsx":
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  "src/app/middleware.ts": `import { notFound, redirect } from "@farm.js/core";
export function middleware(request: Request, ctx: { headers: Headers }) {
  const { pathname } = new URL(request.url);
  ctx.headers.set("x-middleware", "ran");
  if (pathname === "/moved") redirect("/target");
  if (pathname === "/gone") notFound();
}`,
  "src/app/target/page.tsx": "export default function Target() { return <main>target</main>; }",
  "src/app/moved/page.tsx": "export default function Moved() { return <main>moved</main>; }",
  "src/app/gone/page.tsx": "export default function Gone() { return <main>gone</main>; }",
};

async function createApp(prefix: string): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

type Run = (origin: string) => Promise<void>;

async function runInDevelopment(run: Run): Promise<void> {
  const server = await createServer({ root: await createApp("farm-mw-control-headers-dev-") });
  devServers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  await run(`http://localhost:${address.port}`);
}

async function runInProduction(run: Run): Promise<void> {
  const root = await createApp("farm-mw-control-headers-prod-");
  const config = await resolveConfig(
    { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
    "production",
  );
  await build(config, { root, preset: "node-server" });
  const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
  try {
    await run(server.origin);
  } finally {
    await server.stop();
  }
}

describe.each([
  ["development", runInDevelopment],
  ["production", runInProduction],
] as const)("middleware control flow in %s", (_mode, run) => {
  it("keeps the headers middleware set on its redirect() and notFound()", async () => {
    await run(async (origin) => {
      const moved = await fetch(`${origin}/moved`, { redirect: "manual" });
      expect(moved.status).toBe(307);
      expect(moved.headers.get("location")).toBe("/target");
      expect(moved.headers.get("x-middleware")).toBe("ran");

      const gone = await fetch(`${origin}/gone`);
      expect(gone.status).toBe(404);
      expect(gone.headers.get("x-middleware")).toBe("ran");
    });
  }, 180_000);
});
