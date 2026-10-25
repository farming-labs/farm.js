// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectFarmDocsModulePreloads,
  createFarmDocsModulePreloadPlugin,
  encodeFarmDocsModulePreloads,
  readFarmDocsModulePreloads,
} from "../docs/module-preloads";

// Use the host's absolute paths, including the drive letter on Windows, just
// like Vite's module IDs and the resolved project root in a real build.
const ROOT = path.resolve("/app");
const moduleId = (relative: string) => path.join(ROOT, relative);
const chunk = (
  fileName: string,
  options: { facade?: string; imports?: string[]; entry?: boolean; name?: string } = {},
) => ({
  type: "chunk",
  fileName,
  name: options.name ?? fileName,
  isEntry: options.entry ?? false,
  facadeModuleId: options.facade ?? null,
  imports: options.imports ?? [],
});

function bundle() {
  return Object.fromEntries(
    [
      chunk("farm-client-h1.js", {
        entry: true,
        name: "farm-client",
        imports: ["chunks/runtime.js"],
      }),
      chunk("chunks/runtime.js"),
      chunk("chunks/react.js"),
      chunk("chunks/adapter.js", {
        facade: moduleId("node_modules/@farming-labs/farmjs/dist/react.js"),
        imports: ["chunks/react.js", "chunks/runtime.js"],
      }),
      chunk("chunks/docs.config.js", {
        facade: moduleId("docs.config.ts"),
        imports: ["chunks/react.js"],
      }),
      chunk("chunks/page-a.js", {
        facade: moduleId("src/app/docs/page.mdx"),
        imports: ["chunks/react.js", "chunks/tabs.js"],
      }),
      chunk("chunks/tabs.js", { imports: ["chunks/react.js"] }),
      chunk("chunks/page-b.js", { facade: moduleId("src/app/docs/guide/page.md") + "?import" }),
      chunk("chunks/outside.js", { facade: path.resolve("/elsewhere/readme.md") }),
      chunk("chunks/neighbor.js", { facade: ROOT + "-other/readme.md" }),
      { type: "asset", fileName: "farm-client.css" },
    ].map((output) => [output.fileName, output]),
  );
}

const runtimeModuleIds = [
  moduleId("node_modules/@farming-labs/farmjs/dist/react.js"),
  moduleId("docs.config.ts"),
];
const files = (manifest: ReturnType<typeof collectFarmDocsModulePreloads>, indexes: number[]) =>
  indexes.map((index) => manifest!.files[index]);

describe("docs module preloads", () => {
  it.each(["native", "forward slash", "backslash"])(
    "lists the entry and docs adapter graph once, and each page's own chunks (%s IDs)",
    (separator) => {
      const outputs = bundle();
      for (const output of Object.values(outputs)) {
        if ("facadeModuleId" in output && output.facadeModuleId) {
          if (separator === "forward slash")
            output.facadeModuleId = output.facadeModuleId.replace(/\\/g, "/");
          if (separator === "backslash")
            output.facadeModuleId = output.facadeModuleId.replace(/\//g, "\\");
        }
      }
      const manifest = collectFarmDocsModulePreloads(outputs, {
        root: ROOT,
        entryName: "farm-client",
        runtimeModuleIds,
      });

      expect(files(manifest, manifest!.runtime)).toEqual([
        "farm-client-h1.js",
        "chunks/runtime.js",
        "chunks/adapter.js",
        "chunks/react.js",
        "chunks/docs.config.js",
      ]);
      // Chunks already in the runtime list are not repeated per page.
      expect(files(manifest, manifest!.pages["/src/app/docs/page.mdx"]!)).toEqual([
        "chunks/page-a.js",
        "chunks/tabs.js",
      ]);
      expect(files(manifest, manifest!.pages["/src/app/docs/guide/page.md"]!)).toEqual([
        "chunks/page-b.js",
      ]);
      expect(Object.keys(manifest!.pages)).toEqual([
        "/src/app/docs/page.mdx",
        "/src/app/docs/guide/page.md",
      ]);
    },
  );

  it("records nothing when the bundle has no docs adapter chunk", () => {
    expect(
      collectFarmDocsModulePreloads(bundle(), {
        root: ROOT,
        entryName: "farm-client",
        runtimeModuleIds: [moduleId("node_modules/other/react.js")],
      }),
    ).toBeNull();
  });

  it("encodes the manifest for a string literal of any quote style", () => {
    const manifest = {
      files: ["chunks/a'b`c${d} .js", 'chunks/"q".js'],
      runtime: [0],
      pages: { "/src/app/docs/it's/page.mdx": [1] },
    };
    const encoded = encodeFarmDocsModulePreloads(manifest);
    for (const quote of ['"', "'", "`"]) {
      expect(JSON.parse(new Function(`return ${quote}${encoded}${quote};`)())).toEqual(manifest);
    }
    expect(JSON.parse(new Function(`return "${encodeFarmDocsModulePreloads(null)}";`)())).toBe(
      null,
    );
  });

  it("writes the manifest next to the build output and reads it back", async () => {
    const buildDir = mkdtempSync(path.join(tmpdir(), "farm-docs-preloads-"));
    try {
      const plugin = createFarmDocsModulePreloadPlugin({
        root: ROOT,
        buildDir,
        importer: moduleId(".farm/tmp/entry.tsx"),
        entryName: "farm-client",
        modules: ["@farming-labs/farmjs/react", moduleId("docs.config.ts")],
      });
      await plugin.buildStart.call({
        resolve: async (specifier: string) => ({
          id: path.isAbsolute(specifier)
            ? specifier
            : moduleId("node_modules/@farming-labs/farmjs/dist/react.js"),
        }),
      });
      await plugin.generateBundle(undefined, bundle());
      const manifest = await readFarmDocsModulePreloads(buildDir);
      expect(manifest?.pages["/src/app/docs/page.mdx"]).toBeDefined();

      // A later build without the adapter chunk replaces it instead of leaving it stale.
      await plugin.generateBundle(undefined, {
        "farm-client-h1.js": bundle()["farm-client-h1.js"]!,
      });
      expect(await readFarmDocsModulePreloads(buildDir)).toBeNull();
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });
});
