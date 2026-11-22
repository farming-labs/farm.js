// @vitest-environment node

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { createFarmPrivateClientSourcemapsPlugin } from "../nitro/client-sourcemaps";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createFarmPrivateClientSourcemapsPlugin", () => {
  it("keeps the map Vite writes after it starts the entry with its preload map", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-client-sourcemaps-"));
    dirs.push(dir);
    // The router and the island share a module the entry does not load, so the entry's dynamic
    // imports preload it and Vite puts its preload map on the entry's first line.
    await writeFile(join(dir, "shared.mjs"), "export const twice = (value) => value * 2;\n");
    await writeFile(
      join(dir, "entry.mjs"),
      // An app build drops the entry's exports, so the imports are reached through `window`.
      'window.loadRouter = () => import("./router.mjs");\n' +
        'window.loadIsland = () => import("./island.mjs");\n',
    );
    await writeFile(
      join(dir, "router.mjs"),
      'import { twice } from "./shared.mjs";\nexport const navigate = (to) => twice(to);\n',
    );
    await writeFile(
      join(dir, "island.mjs"),
      'import { twice } from "./shared.mjs";\nexport default () => twice(3);\n',
    );
    const outDir = join(dir, "public");
    const mapsDir = join(dir, "client-sourcemaps");
    await build({
      root: dir,
      configFile: false,
      logLevel: "silent",
      plugins: [createFarmPrivateClientSourcemapsPlugin({ outDir: mapsDir })],
      build: {
        outDir,
        sourcemap: "hidden",
        modulePreload: { polyfill: false },
        rollupOptions: {
          input: { "farm-client": join(dir, "entry.mjs") },
          output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name].js" },
        },
      },
    });

    const code = await readFile(join(outDir, "farm-client.js"), "utf8");
    expect(code.startsWith("const __vite__mapDeps=")).toBe(true);
    expect(
      (await readdir(outDir, { recursive: true })).filter((file) => file.endsWith(".map")),
    ).toEqual([]);

    // A position in the served entry maps back to the line of the module it came from.
    const map = new TraceMap(await readFile(join(mapsDir, "farm-client.js.map"), "utf8"));
    const lines = code.split("\n");
    const line = lines.findIndex((text) => text.includes("loadIsland"));
    const column = lines[line]!.indexOf("loadIsland");
    const original = originalPositionFor(map, { line: line + 1, column });
    expect(original.source).toMatch(/entry\.mjs$/);
    expect(original.line).toBe(2);
  });
});
