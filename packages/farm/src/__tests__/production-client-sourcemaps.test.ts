// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";

/**
 * A client source map carries each module's original source. Farm strips
 * createServerOnlyFn bodies and generateMetadata from the client JS, but a
 * public map next to the chunk still published them.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_FN_MARKER = "SERVER_ONLY_FN_BODY_MARKER";
const METADATA_MARKER = "GENMETA_SERVER_MARKER";

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-client-sourcemaps-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "lib"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default { srcDir: "src", images: { provider: "none" }, vite: { build: { sourcemap: true } } };`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "lib", "vault.ts"),
    `
import { createServerOnlyFn } from "@farm.js/core/environment";

export const readVault = createServerOnlyFn(() => "${SERVER_FN_MARKER}_" + process.env.HOME);
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "counter.tsx"),
    `
"use client";
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
`.trim(),
  );
  // The page hydrates (it renders a client component), so its module and
  // the module it imports the server-only function from reach the client graph.
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `
import { Counter } from "./counter";
import { readVault } from "../lib/vault";

export async function generateMetadata() {
  return { title: "${METADATA_MARKER}_" + "x" };
}

export default function HomePage() {
  const vault = typeof window === "undefined" ? readVault().length : 0;
  return <main>home {vault}<Counter /></main>;
}
`.trim(),
  );
  return root;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("production client source maps", () => {
  it("keeps maps with server-only source out of the public output", async () => {
    const root = await createFixture();

    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });

      const publicFiles = [
        ...(await listFiles(path.join(root, ".farm", "client"))),
        ...(await listFiles(path.join(root, ".farm", ".output", "public"))),
      ];
      expect(publicFiles.some((file) => file.endsWith(".js"))).toBe(true);
      expect(publicFiles.filter((file) => file.endsWith(".map"))).toEqual([]);
      for (const file of publicFiles.filter((name) => /\.(js|css|map)$/.test(name))) {
        const contents = await fs.readFile(file, "utf8");
        expect(contents, file).not.toContain(SERVER_FN_MARKER);
        expect(contents, file).not.toContain(METADATA_MARKER);
        expect(contents, file).not.toMatch(/sourceMappingURL=/);
      }

      // The maps still exist for an error tracker to upload, outside public,
      // and they are what carried the server-only source.
      const privateMaps = await listFiles(path.join(root, ".farm", "client-sourcemaps"));
      expect(privateMaps.some((file) => file.endsWith(".js.map"))).toBe(true);
      const privateSources = await Promise.all(
        privateMaps.map((file) => fs.readFile(file, "utf8")),
      );
      expect(privateSources.join("\n")).toContain(SERVER_FN_MARKER);
      expect(privateSources.join("\n")).toContain(METADATA_MARKER);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
