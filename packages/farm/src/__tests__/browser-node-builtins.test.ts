// @vitest-environment node

import fs from "node:fs/promises";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { init, parse } from "es-module-lexer";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

/**
 * A package in the client graph that imports a Node builtin, as
 * `@harness-sdk/ai-sdk` does with `import { randomUUID } from "node:crypto"`,
 * must not leave that import in browser code: the browser cannot load
 * `node:crypto`, so the whole chunk fails and the page never hydrates.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function createFixture(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, prefix));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  const pkg = path.join(root, "node_modules", "uuid-lib");
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "uuid-lib", version: "1.0.0", type: "module", exports: "./index.js" }),
  );
  await fs.writeFile(
    path.join(pkg, "index.js"),
    `import { randomUUID, createHash } from "node:crypto";
import { getRandomValues } from "crypto";
export const newId = () => randomUUID();
export const randomByte = () => getRandomValues(new Uint8Array(1)).length;
export const canHash = () => typeof createHash === "function";
`,
  );
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default { srcDir: "src", images: { provider: "none" } };`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "widget.tsx"),
    `"use client";
import { useState } from "react";
import { newId } from "uuid-lib";

export function Widget() {
  const [id, setId] = useState("");
  return <button onClick={() => setId(newId())}>{id || "new id"}</button>;
}
`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `import { Widget } from "./widget";

export default function HomePage() {
  return <main><Widget /></main>;
}
`,
  );
  return root;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

async function builtinImports(code: string): Promise<string[]> {
  await init;
  const [imports] = parse(code);
  return imports.flatMap(({ n }) => (n && isBuiltin(n) ? [n] : []));
}

describe("Node builtins imported from client code", () => {
  it("leaves no builtin import in the production client chunks", async () => {
    const root = await createFixture(".tmp-browser-builtins-build-");
    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });

      const scripts = (await listFiles(path.join(root, ".farm", ".output", "public"))).filter(
        (file) => file.endsWith(".js"),
      );
      expect(scripts.length).toBeGreaterThan(0);
      const sources = await Promise.all(scripts.map((file) => fs.readFile(file, "utf8")));
      for (const [index, source] of sources.entries()) {
        expect(await builtinImports(source), scripts[index]).toEqual([]);
      }
      expect(sources.join("\n")).toContain("globalThis.crypto.randomUUID()");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("resolves the builtin to Farm's browser module in development", async () => {
    const root = await createFixture(".tmp-browser-builtins-dev-");
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      server = await createServer({
        root,
        srcDir: "src",
        images: { provider: "none" },
        vite: { optimizeDeps: { include: ["uuid-lib"] } },
      });
      await server.listen(await getAvailablePort());
      const client = server.environments.client;

      const resolved = await client.pluginContainer.resolveId(
        "node:crypto",
        path.join(root, "src", "app", "widget.tsx"),
      );
      expect(resolved?.id).toBe("\0farm:browser-builtin:crypto");

      // The pre-bundled dependency is the module the browser runs.
      const widget = await client.transformRequest("/src/app/widget.tsx");
      const depUrl = widget?.code.match(/["']([^"']*\.vite\/deps\/uuid-lib\.js[^"']*)["']/)?.[1];
      expect(depUrl).toBeDefined();
      await client.transformRequest(depUrl!);
      const depFile = path.join(root, "node_modules", ".vite", "deps", "uuid-lib.js");
      const depSource = await fs.readFile(depFile, "utf8");
      expect(await builtinImports(depSource)).toEqual([]);
      expect(depSource).not.toContain("externalized for browser compatibility");

      const lib = await import(pathToFileURL(depFile).href);
      expect(lib.newId()).toMatch(UUID_RE);
      expect(lib.randomByte()).toBe(1);
      expect(lib.canHash()).toBe(false);
    } finally {
      await server?.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 120_000);
});
