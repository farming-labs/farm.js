// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { FARM_EAGER_COMPILE_HINT } from "../nitro/islands-react-chunk";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VENDOR_CHUNKS = `{ manualChunks: (id) => (id.includes("node_modules") ? "vendor" : undefined) }`;

/** Where an islands app's farm.config.ts splits the client's chunks, if anywhere. */
type Chunking = "none" | "config" | "plugin" | "banner";

/** An islands app around one client component, with its chunking set where `chunking` says. */
async function createFixture(chunking: Chunking): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-islands-react-chunk-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  const vite = {
    none: "{}",
    banner: '{ build: { rollupOptions: { output: { postBanner: "/* app banner */" } } } }',
    config: `{ build: { rollupOptions: { output: ${VENDOR_CHUNKS} } } }`,
    plugin: `{
    plugins: [
      {
        name: "app:vendor-chunks",
        config: () => ({ build: { rollupOptions: { output: ${VENDOR_CHUNKS} } } }),
      },
    ],
  }`,
  }[chunking];
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default {
  srcDir: "src",
  images: { provider: "none" },
  experimental: { serverComponents: { mode: "islands" } },
  vite: ${vite},
};
`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "components", "counter.tsx"),
    `"use client";
import { useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return <button type="button" onClick={() => setCount(count + 1)}>{count}</button>;
}`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `import { Counter } from "../components/counter";
export default function HomePage() { return <main><Counter /></main>; }`,
  );
  return root;
}

/** The client build's chunks by name, as `chunks/<name>-h<hash>.js` names them. */
async function buildChunks(chunking: Chunking): Promise<Map<string, string>> {
  const root = await createFixture(chunking);
  try {
    const userConfig = await loadConfig(root, undefined, "production");
    const config = await resolveConfig({ ...userConfig, root }, "production");
    await build(config, { root, preset: "node-server" });
    const dir = path.join(root, ".farm", ".output", "public", "chunks");
    const chunks = new Map<string, string>();
    for (const file of await fs.readdir(dir)) {
      const name = /^(.+)-h[0-9a-f]+\.js$/.exec(file)?.[1];
      if (name) chunks.set(name, await fs.readFile(path.join(dir, file), "utf8"));
    }
    return chunks;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("islands mode's React chunk in a production build", () => {
  it("puts React and React DOM in one chunk, compiled as it streams in", async () => {
    const chunks = await buildChunks("none");
    expect(chunks.get("react")?.startsWith(`${FARM_EAGER_COMPILE_HINT}\n`)).toBe(true);
    expect(chunks.has("vendor")).toBe(false);
  }, 180_000);

  it("keeps the app's postBanner when Farm groups React", async () => {
    const chunks = await buildChunks("banner");
    expect(chunks.get("react")).toContain("/* app banner */");
    for (const code of chunks.values()) expect(code).toContain("/* app banner */");
  }, 180_000);

  it.each(["config", "plugin"] as const)(
    "leaves chunks to the app when its Vite %s splits them",
    async (chunking) => {
      const chunks = await buildChunks(chunking);
      expect(chunks.has("vendor")).toBe(true);
      expect(chunks.has("react")).toBe(false);
      for (const code of chunks.values()) expect(code).not.toContain(FARM_EAGER_COMPILE_HINT);
    },
    180_000,
  );
});
