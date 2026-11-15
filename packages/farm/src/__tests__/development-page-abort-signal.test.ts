// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

/**
 * A page's request signal aborts when the client goes away in development, as in production, so
 * rendering (and the server functions it calls) that observes it can stop.
 */
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

declare global {
  // Set by the pages below; they render in this process under Vite SSR.
  var __farmPageAbortProbe: { started: boolean; aborted: boolean } | undefined;
}

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

async function startApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-page-abort-"));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
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
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  );
  // The shell streams first; the Suspense child waits until the request is aborted.
  await writeModule(
    root,
    "src/app/slow/page.tsx",
    `import { Suspense } from "react";
import { getCurrentRequest } from "@farm.js/core";
async function Late({ signal }) {
  const probe = (globalThis.__farmPageAbortProbe = { started: true, aborted: false });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 20_000);
    signal.addEventListener("abort", () => {
      probe.aborted = true;
      clearTimeout(timer);
      resolve(undefined);
    });
  });
  return <p>late</p>;
}
export default function Slow() {
  return <main>shell<Suspense fallback={<p>waiting</p>}><Late signal={getCurrentRequest().signal} /></Suspense></main>;
}`,
  );
  await writeModule(
    root,
    "src/app/done/page.tsx",
    `import { getCurrentRequest } from "@farm.js/core";
export default function Done() {
  const probe = (globalThis.__farmPageAbortProbe = { started: true, aborted: false });
  getCurrentRequest().signal.addEventListener("abort", () => { probe.aborted = true; });
  return <main>done</main>;
}`,
  );

  const server = await createServer({ root, images: { provider: "none" }, telemetry: false });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

describe("development page request signal", () => {
  it("aborts when the client disconnects while the page streams", async () => {
    const origin = await startApp();
    globalThis.__farmPageAbortProbe = undefined;
    const client = new AbortController();
    const response = await fetch(`${origin}/slow`, { signal: client.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read();
    await vi.waitFor(() => expect(globalThis.__farmPageAbortProbe?.started).toBe(true), {
      timeout: 5_000,
    });
    expect(globalThis.__farmPageAbortProbe?.aborted).toBe(false);

    client.abort();
    await reader.cancel().catch(() => undefined);

    await vi.waitFor(() => expect(globalThis.__farmPageAbortProbe?.aborted).toBe(true), {
      timeout: 5_000,
    });
  }, 60_000);

  it("leaves the signal alone when the page finishes", async () => {
    const origin = await startApp();
    globalThis.__farmPageAbortProbe = undefined;
    const response = await fetch(`${origin}/done`);
    expect(await response.text()).toContain("done");
    // Give a late close event the chance to fire before checking.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(globalThis.__farmPageAbortProbe?.started).toBe(true);
    expect(globalThis.__farmPageAbortProbe?.aborted).toBe(false);
  }, 60_000);
});
