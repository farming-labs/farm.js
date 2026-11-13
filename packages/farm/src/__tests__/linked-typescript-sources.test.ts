// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { build } from "../build";
import { resolveConfig } from "../config";
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

// A monorepo app whose page imports a sibling package's TypeScript source by path. The source
// imports its own modules the way TypeScript's bundler resolution allows: without an
// extension, with a `.js` extension for a `.ts` file, and by directory.
async function createWorkspace(): Promise<string> {
  const workspace = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "farm-linked-ts-sources-")),
  );
  temporaryRoots.add(workspace);
  const root = path.join(workspace, "apps/site");
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
    workspace,
    "packages/lib/src/wire/ops.ts",
    `import { label } from "../util/label";
import { separator } from "../util/separator.js";
import { prefix } from "../prefix";
export function describeOp(op: string): string {
  return label(prefix + separator + op);
}`,
  );
  await writeModule(
    workspace,
    "packages/lib/src/util/label.ts",
    `export function label(text: string): string {
  return "[" + text + "]";
}`,
  );
  await writeModule(
    workspace,
    "packages/lib/src/util/separator.ts",
    `export const separator = ":";`,
  );
  await writeModule(workspace, "packages/lib/src/prefix/index.ts", `export const prefix = "op";`);
  await writeModule(
    root,
    "src/app/layout.tsx",
    `export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
  );
  await writeModule(
    root,
    "src/app/page.tsx",
    `import { describeOp } from "../../../../packages/lib/src/wire/ops.ts";
export default function Page() {
  return <main><h1>{describeOp("set")}</h1></main>;
}`,
  );
  return root;
}

describe("TypeScript sources outside the app root", () => {
  it("render in development when they import siblings without a .ts extension", async () => {
    const root = await createWorkspace();
    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    const page = await fetch(`http://localhost:${address.port}/`, {
      headers: { accept: "text/html" },
    });
    expect(await page.text()).toContain("<h1>[op:set]</h1>");
    expect(page.status).toBe(200);
  }, 60_000);

  it("render in production when they import siblings without a .ts extension", async () => {
    const root = await createWorkspace();
    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        images: { provider: "none" },
        telemetry: false,
        deploy: { target: "vercel" },
      },
      "production",
    );
    await build(config, { root, preset: "vercel" });
    const functionPath = path.resolve(
      root,
      config.deploy.outputDir,
      "functions",
      "__nitro.func",
      "index.mjs",
    );
    const { default: handler } = await import(/* @vite-ignore */ pathToFileURL(functionPath).href);

    const page = await handler.fetch(
      new Request("https://site.test/", { headers: { accept: "text/html" } }),
    );
    expect(await page.text()).toContain("<h1>[op:set]</h1>");
    expect(page.status).toBe(200);
  }, 180_000);

  it("hydrate their client components as islands in production", async () => {
    const root = await createWorkspace();
    const workspace = path.resolve(root, "../..");
    // The package depends on React, not on Farm, whose runtime the island transform imports.
    await fs.mkdir(path.join(workspace, "packages/lib/node_modules"), { recursive: true });
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", "react")),
      path.join(workspace, "packages/lib/node_modules/react"),
      "junction",
    );
    await writeModule(
      workspace,
      "packages/lib/src/counter.tsx",
      `"use client";
import { useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>count {count}</button>;
}`,
    );
    await writeModule(
      root,
      "src/app/page.tsx",
      `import { Counter } from "../../../../packages/lib/src/counter";
export default function Page() {
  return <main><Counter /></main>;
}`,
    );
    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        images: { provider: "none" },
        telemetry: false,
        deploy: { target: "vercel" },
        experimental: { serverComponents: { mode: "islands" } },
      },
      "production",
    );
    await build(config, { root, preset: "vercel" });
    const functionPath = path.resolve(
      root,
      config.deploy.outputDir,
      "functions",
      "__nitro.func",
      "index.mjs",
    );
    const { default: handler } = await import(/* @vite-ignore */ pathToFileURL(functionPath).href);

    const page = await handler.fetch(
      new Request("https://site.test/", { headers: { accept: "text/html" } }),
    );
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toMatch(/<f-island src="[^"]*\/packages\/lib\/src\/counter\.tsx"/);
    expect(html).toContain("count <!-- -->0");
  }, 180_000);

  it("render package client components their server components import as islands in production", async () => {
    const root = await createWorkspace();
    const workspace = path.resolve(root, "../..");
    // Only the workspace package depends on the client package, as a UI package depends on Radix.
    const lib = path.join(workspace, "packages/lib");
    await fs.mkdir(path.join(lib, "node_modules"), { recursive: true });
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", "react")),
      path.join(lib, "node_modules/react"),
      "junction",
    );
    await writeModule(
      lib,
      "node_modules/toggle-kit/package.json",
      JSON.stringify({ name: "toggle-kit", type: "module", exports: { ".": "./index.js" } }),
    );
    await writeModule(
      lib,
      "node_modules/toggle-kit/index.js",
      `"use client";
import { createElement, useState } from "react";
export function Toggle() {
  const [on, setOn] = useState(false);
  return createElement("button", { onClick: () => setOn(!on) }, on ? "on" : "off");
}`,
    );
    await writeModule(
      lib,
      "src/panel.tsx",
      `import { Toggle } from "toggle-kit";
export function Panel() {
  return <section><Toggle /></section>;
}`,
    );
    await writeModule(
      root,
      "src/app/page.tsx",
      `import { Panel } from "../../../../packages/lib/src/panel";
export default function Page() {
  return <main><Panel /></main>;
}`,
    );
    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        images: { provider: "none" },
        telemetry: false,
        deploy: { target: "vercel" },
        experimental: { serverComponents: { mode: "islands" } },
      },
      "production",
    );
    await build(config, { root, preset: "vercel" });
    const functionPath = path.resolve(
      root,
      config.deploy.outputDir,
      "functions",
      "__nitro.func",
      "index.mjs",
    );
    const { default: handler } = await import(/* @vite-ignore */ pathToFileURL(functionPath).href);

    const page = await handler.fetch(
      new Request("https://site.test/", { headers: { accept: "text/html" } }),
    );
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toMatch(
      /<f-island src="\/\.farm\/client-references\/toggle-kit\/[^"]*Toggle\.tsx"/,
    );
    expect(html).toContain(">off</button>");
  }, 180_000);
});
