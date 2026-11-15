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
 * An `error.tsx` page whose root layout renders its own `<html>` starts its head with the charset
 * and the viewport, as every other document does. Production used to leave both out, so the error
 * page laid out at desktop width on phones.
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
  "src/app/layout.tsx": `export default function Layout({ children }) {
  return <html lang="de"><body>{children}</body></html>;
}`,
  "src/app/fail/page.tsx": `export default function Fail() { throw new Error("failed"); }`,
  "src/app/fail/error.tsx": `"use client";
export default function FailError() { return <main>Fehler – ü</main>; }`,
  // A layout that writes its own viewport keeps it, with no second one added.
  "src/app/own/layout.tsx": `export default function OwnLayout({ children }) {
  return <html lang="de"><head><meta name="viewport" content="width=500" /></head><body>{children}</body></html>;
}`,
  "src/app/own/fail/page.tsx": `export default function Fail() { throw new Error("failed"); }`,
  "src/app/own/fail/error.tsx": `"use client";
export default function OwnError() { return <main>own error</main>; }`,
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
  const server = await createServer({ root: await createApp("farm-error-head-dev-") });
  devServers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  await run(`http://localhost:${address.port}`);
}

async function runInProduction(run: Run): Promise<void> {
  const root = await createApp("farm-error-head-prod-");
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

async function errorHead(origin: string, pathname: string) {
  const response = await fetch(`${origin}${pathname}`);
  const html = await response.text();
  return {
    status: response.status,
    head: /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "",
    html,
  };
}

describe.each([
  ["development", runInDevelopment],
  ["production", runInProduction],
] as const)("an error.tsx document in %s", (_mode, run) => {
  it("starts its head with the charset and the viewport", async () => {
    await run(async (origin) => {
      const page = await errorHead(origin, "/fail");
      expect(page.status).toBe(500);
      expect(page.html).toContain("Fehler – ü");
      expect(page.head.trimStart()).toMatch(/^<meta charset="utf-8"/i);
      expect(page.head).toMatch(
        /<meta name="viewport" content="width=device-width, initial-scale=1"/i,
      );

      const own = await errorHead(origin, "/own/fail");
      expect(own.status).toBe(500);
      expect(own.head).toMatch(/<meta charset="utf-8"/i);
      expect(own.head.match(/<meta name="viewport"/gi)).toHaveLength(1);
      expect(own.head).toContain('content="width=500"');
    });
  }, 180_000);
});
