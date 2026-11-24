// @vitest-environment node

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown, type OutputChunk } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";
import {
  FARM_EAGER_COMPILE_HINT,
  configuresFarmClientChunks,
  createFarmIslandsReactOutput,
} from "../nitro/islands-react-chunk";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const REACT_PACKAGE = /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/;

/** Bundles `files` with islands mode's output for React, as its client build does, with the real React. */
async function bundle(files: Record<string, string>): Promise<OutputChunk[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "farm-islands-react-chunk-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "node_modules"));
  const reactDom = await realpath(path.join(packageRoot, "node_modules", "react-dom"));
  for (const [name, target] of [
    ["react", path.join(packageRoot, "node_modules", "react")],
    ["react-dom", reactDom],
    // React DOM's own dependency, next to it in pnpm's store.
    ["scheduler", path.join(reactDom, "..", "scheduler")],
  ] as const) {
    await symlink(await realpath(target), path.join(dir, "node_modules", name), "junction");
  }
  for (const [file, source] of Object.entries(files)) {
    await writeFile(path.join(dir, file), source);
  }
  const build = await rolldown({ input: path.join(dir, "entry.mjs"), platform: "browser" });
  const { output } = await build.generate({
    format: "esm",
    sourcemap: true,
    ...createFarmIslandsReactOutput(),
  });
  await build.close();
  return output.filter((chunk): chunk is OutputChunk => chunk.type === "chunk");
}

/** The packages of React's whose modules `chunks` hold. */
function reactPackages(chunks: OutputChunk[]): string[] {
  const names = chunks.flatMap((chunk) =>
    chunk.moduleIds.map((id) => REACT_PACKAGE.exec(id)?.[1]).filter(Boolean),
  );
  return [...new Set(names)].sort() as string[];
}

/** The entry chunk and every chunk it imports statically: what a page loads with it. */
function loadedWithEntry(chunks: OutputChunk[]): OutputChunk[] {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const loaded = new Set<OutputChunk>();
  const pending = chunks.filter((chunk) => chunk.isEntry);
  for (let chunk = pending.pop(); chunk; chunk = pending.pop()) {
    if (loaded.has(chunk)) continue;
    loaded.add(chunk);
    pending.push(...chunk.imports.map((name) => byName.get(name)!));
  }
  return [...loaded];
}

const ISLANDS = {
  // The islands entry imports its renderer when an island is due, and the island its component.
  "runtime.mjs": `import { hydrateRoot } from "react-dom/client";
export const hydrate = (element) => hydrateRoot(document, element);`,
  "island.mjs": `import { useState } from "react";
import { jsx } from "react/jsx-runtime";
export const Island = () => jsx("button", { children: String(useState(0)[0]) });`,
};

describe("islands mode's React chunk", () => {
  it("holds React, its JSX runtime and React DOM, which the entry loads when an island is due", async () => {
    const chunks = await bundle({
      ...ISLANDS,
      "entry.mjs": `export const load = () => Promise.all([import("./runtime.mjs"), import("./island.mjs")]);`,
    });
    const holding = chunks.filter((chunk) => reactPackages([chunk]).length > 0);
    expect(holding.map((chunk) => chunk.name)).toEqual(["react"]);
    expect(reactPackages(holding)).toEqual(["react", "react-dom", "scheduler"]);
    expect(holding[0]!.moduleIds.some((id) => /[\\/]react[\\/]jsx-runtime\.js$/.test(id))).toBe(
      true,
    );
    expect(reactPackages(loadedWithEntry(chunks))).toEqual([]);
    // Compiled as it streams in, with the source map still pointing at React's code.
    const hinted = chunks.filter((chunk) => chunk.code.startsWith(FARM_EAGER_COMPILE_HINT));
    expect(hinted.map((chunk) => chunk.fileName)).toEqual([holding[0]!.fileName]);
    expect(holding[0]!.code.startsWith(`${FARM_EAGER_COMPILE_HINT}\n`)).toBe(true);
    expect(holding[0]!.map?.mappings.startsWith(";")).toBe(true);
    // The other chunks start as they would without it.
    expect(chunks.filter((chunk) => /^\s/.test(chunk.code))).toEqual([]);
  });

  it("stays out of an entry that imports React, which would load React DOM with every page", async () => {
    const chunks = await bundle({
      ...ISLANDS,
      "entry.mjs": `import { createElement } from "react";
export const element = createElement("p");
export const load = () => Promise.all([import("./runtime.mjs"), import("./island.mjs")]);`,
    });
    // The bundler's own split: React with the entry, React DOM in a chunk of its own.
    expect(reactPackages(loadedWithEntry(chunks))).toEqual(["react"]);
    expect(chunks.filter((chunk) => reactPackages([chunk]).includes("react-dom"))).toHaveLength(1);
    expect(chunks.some((chunk) => chunk.code.includes(FARM_EAGER_COMPILE_HINT))).toBe(false);
  });

  it("leaves chunks to an app whose Vite config splits them", () => {
    expect(configuresFarmClientChunks(undefined)).toBe(false);
    expect(configuresFarmClientChunks({ build: { rollupOptions: { output: {} } } })).toBe(false);
    for (const output of [
      { manualChunks: () => undefined },
      { advancedChunks: { groups: [] } },
      { codeSplitting: false },
      { inlineDynamicImports: true },
    ]) {
      expect(configuresFarmClientChunks({ build: { rollupOptions: { output } } })).toBe(true);
      expect(configuresFarmClientChunks({ build: { rolldownOptions: { output: [output] } } })).toBe(
        true,
      );
    }
  });
});
