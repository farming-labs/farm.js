import fs from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";
import type { Plugin } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { FARM_BROWSER_BUILTIN_PREFIX } from "../browser-builtins";
import { farmDocsClientConfigPlugin } from "../docs/client-config";
import { createFarmThemeCssPlugin } from "../theme/vite";
import { exactIdPattern, fileNamePattern } from "../utils/hook-filters";
import { farmServerOnlyEntriesPlugin } from "../vite";

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    fs.rmSync(temporaryDirs.pop()!, { recursive: true, force: true });
  }
});

type FilteredHook = { filter: { id?: unknown; code?: unknown } };

/** Whether `value` passes a hook filter pattern: a RegExp or a list of them (an include list). */
function passes(pattern: unknown, value: string): boolean {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  return patterns.some((entry) => entry instanceof RegExp && entry.test(value));
}

function hookFilter(
  plugin: Plugin,
  hook: "resolveId" | "load" | "transform",
): FilteredHook["filter"] {
  const value = plugin[hook] as FilteredHook | undefined;
  if (!value || typeof value !== "object" || !("filter" in value)) {
    throw new Error(`${plugin.name} ${hook} has no filter`);
  }
  return value.filter;
}

describe("exactIdPattern", () => {
  it("matches the ids exactly, with or without a query", () => {
    const pattern = exactIdPattern(["@vercel/og", "\0farm:server-only", "a.b+c"]);
    for (const id of ["@vercel/og", "\0farm:server-only", "a.b+c", "@vercel/og?v=1"]) {
      expect(pattern.test(id), id).toBe(true);
    }
    for (const id of ["@vercel/og/x", "x@vercel/og", "farm:server-only", "aXb+c", "a.bbc"]) {
      expect(pattern.test(id), id).toBe(false);
    }
  });
});

describe("fileNamePattern", () => {
  it("matches the files' names in any directory, and a symlinked file's real name", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-hook-filters-")));
    temporaryDirs.push(dir);
    const real = path.join(dir, "shared.config.ts");
    fs.writeFileSync(real, "export default {};\n");
    const link = path.join(dir, "farm.config.ts");
    fs.symlinkSync(real, link);

    const pattern = fileNamePattern([link]);
    for (const id of [
      "/app/farm.config.ts",
      "/app/farm.config.ts?raw",
      "C:/app/farm.config.ts",
      "/store/shared.config.ts",
    ]) {
      expect(pattern.test(id), id).toBe(true);
    }
    for (const id of ["/app/my-farm.config.ts", "/app/farm.config.tsx", "/app/farm.config.ts/x"]) {
      expect(pattern.test(id), id).toBe(false);
    }
  });
});

describe("Farm plugin hook filters", () => {
  it("let farm:server-only-entries resolve every id its handler acts on", () => {
    const plugin = farmServerOnlyEntriesPlugin();
    const resolve = hookFilter(plugin, "resolveId");
    const handled = [
      "@farm.js/core/platform",
      "server-only",
      "@farm.js/core/og",
      ...builtinModules,
      ...builtinModules.map((name) => `node:${name}`),
      "node:sqlite",
    ];
    for (const id of handled) expect(passes(resolve.id, id), id).toBe(true);
    for (const id of ["react", "./page.tsx", "@farm.js/core", "fsx", "node-fetch"]) {
      expect(passes(resolve.id, id), id).toBe(false);
    }

    const load = hookFilter(plugin, "load");
    for (const id of [
      "\0farm:server-only",
      "\0farm:platform-client",
      `${FARM_BROWSER_BUILTIN_PREFIX}fs`,
    ]) {
      expect(passes(load.id, id), id).toBe(true);
    }
    expect(passes(load.id, "/app/src/page.tsx")).toBe(false);
  });

  it("call farm:theme-css only for stylesheets that import Tailwind", () => {
    const filter = hookFilter(createFarmThemeCssPlugin(undefined), "transform");
    expect(passes(filter.id, "/app/src/globals.css")).toBe(true);
    expect(passes(filter.id, "/app/src/globals.css?direct")).toBe(true);
    expect(passes(filter.id, "/app/src/page.tsx")).toBe(false);
    expect(passes(filter.code, '@import "tailwindcss";')).toBe(true);
    expect(passes(filter.code, "body { color: red }")).toBe(false);
  });

  it("call farm:docs-client-config only for the docs config module, and never without one", () => {
    const withConfig = hookFilter(farmDocsClientConfigPlugin("/app/docs.config.ts"), "transform");
    expect(passes(withConfig.id, "/app/docs.config.ts")).toBe(true);
    expect(passes(withConfig.id, "/app/src/page.tsx")).toBe(false);
    const withoutConfig = hookFilter(farmDocsClientConfigPlugin(undefined), "transform");
    for (const id of ["", "/app/docs.config.ts", "/app/src/page.tsx"]) {
      expect(passes(withoutConfig.id, id), id).toBe(false);
    }
  });
});
