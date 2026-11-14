// @vitest-environment node
import { spawn } from "node:child_process";
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

// The not-found and error documents go out whole, with their status. They rendered with React's
// synchronous renderToString, which cannot wait for a Suspense boundary: a root layout holding a
// lazy component or a use(promise) read threw "A component suspended while responding to
// synchronous input" on every unknown URL, and Farm answered with its bare fallback 404 instead
// of the app's not-found page.

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

const FILES: Record<string, string> = {
  "farm.config.ts": `import { defineConfig } from "@farm.js/core";
export default defineConfig({ telemetry: false, images: { provider: "none" } });
`,
  // In the root layout every not-found and error document renders: a lazy component (as
  // code-split docs chrome is) outside any Suspense boundary, which made renderToString throw, and
  // a use(promise) data read inside one, which renderToString left to the client as its fallback.
  "src/app/layout.tsx": `import React, { Suspense, lazy, use } from "react";

const LazyNav = lazy(
  () => new Promise((resolve) =>
    setTimeout(() => resolve({ default: () => <nav>LAZY NAV READY</nav> }), 10),
  ),
);

let release;
function getRelease() {
  release ??= new Promise((resolve) => setTimeout(() => resolve("RELEASE 7"), 10));
  return release;
}

function Release() {
  return <footer>{use(getRelease())}</footer>;
}

export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        <LazyNav />
        {children}
        <Suspense fallback={<p>RELEASE FALLBACK</p>}>
          <Release />
        </Suspense>
      </body>
    </html>
  );
}
`,
  "src/app/page.tsx": "export default function Home() { return <main>HOME</main>; }",
  "src/app/not-found.tsx": `export const metadata = { title: "Lost" };
export default function NotFound() { return <main>CUSTOM NOT FOUND</main>; }`,
  "src/app/broken/page.tsx": `export const dynamic = "force-dynamic";
export default function Broken() { throw new Error("broken page"); }`,
  "src/app/broken/error.tsx": `"use client";
export default function BrokenError() { return <main>CUSTOM ERROR PAGE</main>; }`,
};

async function createApp(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
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
  for (const [file, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return root;
}

/** Every boundary resolved in the document itself: no fallback, no reveal script to run. */
function expectResolvedLayout(html: string, label: string): void {
  expect(html, label).toContain("LAZY NAV READY");
  expect(html, label).toContain("RELEASE 7");
  expect(html, label).not.toContain("RELEASE FALLBACK");
  expect(html, label).not.toContain("$RC(");
}

async function expectSuspendingLayoutDocuments(
  origin: string,
  output: () => string,
): Promise<void> {
  // Repeated requests: the first one finds the layout suspends, later ones must still wait for it.
  for (const pathname of ["/missing", "/docs/missing/deeply", "/missing"]) {
    const response = await fetch(`${origin}${pathname}`, { headers: { accept: "text/html" } });
    const html = await response.text();
    expect(
      { status: response.status, type: response.headers.get("content-type") },
      pathname,
    ).toEqual({ status: 404, type: "text/html; charset=utf-8" });
    expect(html, pathname).toContain("CUSTOM NOT FOUND");
    expect(html, pathname).toMatch(/<title>Lost<\/title>/);
    expectResolvedLayout(html, pathname);
  }

  const broken = await fetch(`${origin}/broken`, { headers: { accept: "text/html" } });
  const brokenHtml = await broken.text();
  expect(broken.status).toBe(500);
  expect(brokenHtml).toContain("CUSTOM ERROR PAGE");
  expectResolvedLayout(brokenHtml, "/broken");

  // Agents still get the Markdown not-found body without rendering the layouts.
  const markdown = await fetch(`${origin}/missing`, { headers: { accept: "text/markdown" } });
  expect(markdown.status).toBe(404);
  expect(markdown.headers.get("x-farm-markdown-error")).toBe("404");
  await markdown.body?.cancel();

  expect(output()).not.toContain("suspended while responding to synchronous input");
  expect(output()).not.toContain("404 render error");
}

describe("not-found and error documents under a suspending root layout", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-not-found-suspense-");
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
      originalError(...args);
    };
    try {
      const server = await createServer({ root });
      devServers.add(server);
      await server.listen(await getAvailablePort());
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Missing dev server address");
      await expectSuspendingLayoutDocuments(`http://localhost:${address.port}`, () =>
        logged.join("\n"),
      );
    } finally {
      console.error = originalError;
    }
  }, 120_000);

  it("in a node-server production build", async () => {
    const root = await createApp("farm-prod-not-found-suspense-");
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    const output = path.join(root, ".farm", ".output");
    const port = await getAvailablePort();
    const processOutput: string[] = [];
    const productionServer = spawn(process.execPath, [path.join(output, "server", "index.mjs")], {
      cwd: path.join(output, "server"),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    productionServer.stdout.on("data", (chunk) => processOutput.push(String(chunk)));
    productionServer.stderr.on("data", (chunk) => processOutput.push(String(chunk)));
    const exited = new Promise<void>((resolve) => productionServer.once("exit", () => resolve()));

    try {
      const origin = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let attempt = 0; attempt < 200 && !ready; attempt++) {
        if (productionServer.exitCode !== null) break;
        ready = await fetch(`${origin}/_farm/health/ready`).then(
          (response) => response.ok,
          () => false,
        );
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(ready, processOutput.join("")).toBe(true);
      await expectSuspendingLayoutDocuments(origin, () => processOutput.join(""));
    } finally {
      if (productionServer.exitCode === null) productionServer.kill();
      await exited;
    }
  }, 240_000);
});
