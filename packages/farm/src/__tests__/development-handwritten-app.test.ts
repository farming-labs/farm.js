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
  vi.restoreAllMocks();
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

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true });
  return entries
    .map((entry) => entry.split(path.sep).join("/"))
    .filter((entry) => !entry.startsWith("node_modules") && !entry.startsWith(".farm"))
    .sort();
}

// The smallest app a person writes by hand: no tsconfig.json, no globals.css, no React
// imports, and a root layout that renders <html> and <body> but no <head>.
describe("development server with a hand-written app", () => {
  it("renders, hydrates and stays quiet without writing files the app did not ask for", async () => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-handwritten-")),
    );
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
      `import { Counter } from "./counter";
export default function Page() {
  return <main><h1>Home</h1><Counter /></main>;
}`,
    );
    await writeModule(
      root,
      "src/app/counter.tsx",
      `"use client";
import { useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>count: {count}</button>;
}`,
    );
    const filesBefore = await listFiles(root);
    const warnings: string[] = [];
    for (const method of ["warn", "log", "error"] as const) {
      const original = console[method].bind(console);
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
        original(...args);
      });
    }

    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    // JSX compiles with the automatic runtime on the server even without a tsconfig.
    const page = await fetch(`${origin}/`, { headers: { accept: "text/html" } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<h1>Home</h1>");

    // The client needs its props and runtime in a real <head> to hydrate.
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(html.match(/<head[\s>]/gi)).toHaveLength(1);
    expect(head).toContain("window.__FARM_PROPS__");
    expect(head).toContain("/@vite/client");
    expect(html.indexOf("</head>")).toBeLessThan(html.indexOf("<body"));

    // There is no globals.css, so nothing links to one.
    expect(html).not.toContain("globals.css");

    // The client component compiles with the automatic runtime too.
    const counter = (await server.transformRequest("/src/app/counter.tsx"))?.code ?? "";
    expect(counter).toContain("jsx-dev-runtime");
    expect(counter).toContain("jsxDEV(");
    expect(counter).not.toContain('React.createElement("button"');

    // Only the route types that typed links read. No stylesheet, and no API client
    // for an app that has no API routes.
    expect((await listFiles(root)).filter((file) => !filesBefore.includes(file))).toEqual([
      "src/farm.d.ts",
    ]);
    expect(warnings.join("\n")).not.toMatch(/full <html> document|React is not defined/);
  }, 60_000);
});
