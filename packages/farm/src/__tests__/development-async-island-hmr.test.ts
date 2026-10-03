// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../utils";
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

async function waitFor(check: () => Promise<boolean>, timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("condition was not met in time");
}

async function startProject(pageSource: string) {
  // The real path: macOS links the temp directory, and Vite's module ids use the target.
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-async-island-hmr-")),
  );
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Island boundaries import Farm's isolated-boundary runtime.
  await fs.symlink(
    await fs.realpath(packageRoot),
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
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
    "src/app/counter.tsx",
    `"use client";
import React from "react";
export function Counter({ start, children }) { return <button>{start}{children}</button>; }`,
  );
  // A server component between the page and the client boundary. Passing JSX
  // children keeps the boundary from becoming an island.
  const wrapper = await writeModule(
    root,
    "src/app/wrapper.tsx",
    `import React from "react";
import { Counter } from "./counter";
export function Wrapper() { return <Counter start={1}><b>static</b></Counter>; }`,
  );
  const page = await writeModule(root, "src/app/page.tsx", pageSource);

  const server = await createServer({ root, images: { provider: "none" } });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  const origin = `http://localhost:${address.port}`;
  const hasIsland = async () =>
    (await (await fetch(origin)).text()).includes("data-farm-client-boundary");
  return { server, wrapper, page, hasIsland };
}

const asyncPage = `import React from "react";
import { Wrapper } from "./wrapper";
export default async function Page() { await Promise.resolve(); return <main><Wrapper /></main>; }`;

describe("development async-owner islands across edits", () => {
  it("picks up a client boundary that another file makes eligible", async () => {
    const { server, wrapper, hasIsland } = await startProject(asyncPage);
    expect(await hasIsland()).toBe(false);

    // Neither the page nor the client component changes, but the boundary
    // now receives only serializable props and must be re-transformed.
    await fs.writeFile(
      wrapper,
      `import React from "react";
import { Counter } from "./counter";
export function Wrapper() { return <Counter start={1} />; }`,
    );
    server.watcher.emit("change", wrapper);
    await waitFor(hasIsland);
  }, 60_000);

  it("keeps HMR working when a page's plan cannot be read", async () => {
    const warn = vi.spyOn(logger, "warn");
    const { server, page } = await startProject(asyncPage);
    await fetch(server.resolvedUrls?.local[0] ?? "");

    // An unknown island strategy makes the plan throw until the file is fixed.
    await fs.writeFile(page, `export const island = "sometimes";\n${asyncPage}`);
    server.watcher.emit("change", page);
    await waitFor(async () =>
      warn.mock.calls.some(([message]) =>
        String(message).includes("Could not update the hydration plan"),
      ),
    );
    warn.mockRestore();
  }, 60_000);
});
