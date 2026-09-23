// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const devServers = new Set<ViteDevServer>();
const productionChildren = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all([...devServers].map((server) => server.close()));
  devServers.clear();
  await Promise.all([...productionChildren].map((stop) => stop()));
  productionChildren.clear();
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

async function linkReact(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
}

// A minimal project whose production build and dev server must agree: a
// `/private/:path*` middleware that short-circuits with 401, one *existing*
// private markdown page, and one public markdown page. There is deliberately
// no `src/app/private/missing/page.md`, so `/private/missing.md` is a missing
// route whose path the guard's matcher still covers.
async function createGuardedProject(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await linkReact(root);
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default {
  middleware: [
    {
      matcher: "/private/:path*",
      handler() {
        return new Response("sign-in required", {
          status: 401,
          headers: { "x-markdown-guard": "yes" },
        });
      },
    },
  ],
};`,
  );
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
  await writeModule(
    root,
    "src/app/private/notes/page.md",
    `# Private notes\n\nprivate-notes-source\n`,
  );
  await writeModule(root, "src/app/open/page.md", `# Open notes\n\nopen-notes-source\n`);
}

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (port === 0) throw new Error("Could not reserve a free port.");
  return port;
}

async function startProductionServer(
  serverDir: string,
  readinessPath = "/",
): Promise<{ origin: string; stop: () => Promise<void> }> {
  const port = await reservePort();
  const output: string[] = [];
  const child = spawn(process.execPath, [path.join(serverDir, "index.mjs")], {
    cwd: serverDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const origin = `http://127.0.0.1:${port}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited before readiness:\n${output.join("")}`);
    }
    try {
      await fetch(`${origin}${readinessPath}`);
      return {
        origin,
        stop: async () => {
          if (child.exitCode !== null) return;
          child.kill("SIGTERM");
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 2_000);
            child.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        },
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  child.kill("SIGKILL");
  throw new Error(
    `Production server did not become ready: ${String(lastError)}\n${output.join("")}`,
  );
}

describe("development markdown 404 runs app middleware before the 404 body", () => {
  it("gates a missing markdown 404 behind a short-circuiting guard, matching an existing guarded route", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-md-404-middleware-dev-"));
    temporaryRoots.add(root);
    await createGuardedProject(root);

    const server = await createServer({ root, images: { provider: "none" } });
    devServers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    // An existing guarded route's .md representation is blocked by the guard.
    const guardedExisting = await fetch(`${origin}/private/notes.md`);
    expect(guardedExisting.status).toBe(401);
    expect(guardedExisting.headers.get("x-markdown-guard")).toBe("yes");
    await expect(guardedExisting.text()).resolves.toBe("sign-in required");

    // A *missing* guarded route must be blocked by the same guard rather than
    // answered with a Markdown 404 body — otherwise it is a route-existence
    // oracle under a guarded prefix (the dev/prod parity bug). The `.md` form
    // and the `Accept: text/markdown` form both opt into the Markdown 404
    // block, so both must be gated.
    const guardedMissingMd = await fetch(`${origin}/private/missing.md`);
    expect(guardedMissingMd.status).toBe(401);
    expect(guardedMissingMd.headers.get("x-markdown-guard")).toBe("yes");
    expect(guardedMissingMd.headers.get("content-type")).not.toContain("text/markdown");
    expect(guardedMissingMd.headers.get("x-farm-markdown-error")).toBeNull();
    await expect(guardedMissingMd.text()).resolves.toBe("sign-in required");

    const guardedMissingAccept = await fetch(`${origin}/private/missing`, {
      headers: { accept: "text/markdown" },
    });
    expect(guardedMissingAccept.status).toBe(401);
    expect(guardedMissingAccept.headers.get("x-markdown-guard")).toBe("yes");
    await expect(guardedMissingAccept.text()).resolves.toBe("sign-in required");

    // The guard only gates paths its matcher covers. A missing route outside
    // the matcher still receives the Markdown 404 body, so the fix is not an
    // over-broad gate that swallows the agent 404 contract.
    const unguardedMissing = await fetch(`${origin}/open/missing.md`);
    expect(unguardedMissing.status).toBe(404);
    expect(unguardedMissing.headers.get("content-type")).toContain("text/markdown");
    expect(unguardedMissing.headers.get("x-farm-markdown-error")).toBe("404");
    const unguardedMissingBody = await unguardedMissing.text();
    expect(unguardedMissingBody).toContain("# Page not found");
    expect(unguardedMissingBody).toContain("/open/missing.md");

    // A guarded browser request that does not opt into Markdown is also
    // blocked (the main middleware execution short-circuits ahead of the
    // HTML 404 render); this confirms the guard applies uniformly.
    const guardedMissingBrowser = await fetch(`${origin}/private/missing`, {
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    expect(guardedMissingBrowser.status).toBe(401);
    expect(guardedMissingBrowser.headers.get("x-markdown-guard")).toBe("yes");

    // An unguarded existing markdown route still serves its source, so the
    // markdown source/mirror handlers still work after the change.
    const openMd = await fetch(`${origin}/open.md`);
    expect(openMd.status).toBe(200);
    expect(openMd.headers.get("content-type")).toContain("text/markdown");
    await expect(openMd.text()).resolves.toContain("open-notes-source");
  }, 30_000);

  it("still serves a Markdown 404 body when no middleware is configured", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-md-404-no-middleware-"));
    temporaryRoots.add(root);
    await linkReact(root);
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

    const server = await createServer({ root, images: { provider: "none" } });
    devServers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    // With no middleware, `runAppMiddlewareForContentRoute` returns false, so
    // the Markdown 404 body is still served for a missing `.md` request.
    const missing = await fetch(`${origin}/missing.md`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/markdown");
    expect(missing.headers.get("x-farm-markdown-error")).toBe("404");
    const body = await missing.text();
    expect(body).toContain("# Page not found");
    expect(body).toContain("/missing.md");
  }, 30_000);
});

describe("production build gates a missing markdown 404 behind app middleware", () => {
  it("blocks a missing guarded markdown route with 401, matching the dev server", async () => {
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-md-404-middleware-prod-"));
    temporaryRoots.add(root);
    await createGuardedProject(root);

    let production: { origin: string; stop: () => Promise<void> } | undefined;
    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });

      production = await startProductionServer(path.join(root, ".farm", ".output", "server"));
      productionChildren.add(production.stop);
      const origin = production.origin;

      // Production gates the same missing guarded markdown path behind the
      // middleware runner that runs before its 404 fallback.
      const missingGuarded = await fetch(`${origin}/private/missing.md`);
      expect(missingGuarded.status).toBe(401);
      expect(missingGuarded.headers.get("x-markdown-guard")).toBe("yes");
      expect(missingGuarded.headers.get("x-farm-markdown-error")).toBeNull();
      await expect(missingGuarded.text()).resolves.toBe("sign-in required");

      // A guarded existing route is likewise blocked.
      const existingGuarded = await fetch(`${origin}/private/notes.md`);
      expect(existingGuarded.status).toBe(401);
      expect(existingGuarded.headers.get("x-markdown-guard")).toBe("yes");

      // An unguarded missing route still gets the Markdown 404 body, so the
      // production gate is no broader than the matcher.
      const unguardedMissing = await fetch(`${origin}/open/missing.md`);
      expect(unguardedMissing.status).toBe(404);
      expect(unguardedMissing.headers.get("content-type")).toContain("text/markdown");
      expect(unguardedMissing.headers.get("x-farm-markdown-error")).toBe("404");
      await expect(unguardedMissing.text()).resolves.toContain("# Page not found");
    } finally {
      if (production) await production.stop();
    }
  }, 180_000);
});
