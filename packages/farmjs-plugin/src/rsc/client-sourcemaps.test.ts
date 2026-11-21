import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import viteRsc from "@vitejs/plugin-rsc";
import { build, createBuilder } from "vite";
import { describe, expect, it } from "vitest";
import { rscPrivateClientSourcemaps } from "./client-sourcemaps.js";
import farmRsc from "./index.js";

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("RSC client source maps", () => {
  // A client map holds the original source of every module in a chunk, so a
  // public one hands out code stripped from the client JS.
  it("keeps client source maps out of the public client output", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-client-sourcemaps-"));
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    try {
      const srcDir = path.join(fixtureRoot, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(
        path.join(fixtureRoot, "package.json"),
        JSON.stringify({ name: "farm-rsc-client-sourcemaps", private: true, type: "module" }),
      );
      writeFileSync(
        path.join(srcDir, "layout.tsx"),
        `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
      );
      writeFileSync(
        path.join(srcDir, "counter.tsx"),
        `"use client";
import { useState } from "react";
export function Counter() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>{count}</button>; }`,
      );
      writeFileSync(
        path.join(srcDir, "page.tsx"),
        `import { Counter } from "./counter";
export default function Page() { return <main><Counter /></main>; }`,
      );
      for (const packageName of [
        "@farm.js/core",
        "@vitejs/plugin-rsc",
        "better-call",
        "react",
        "react-dom",
        "react-server-dom-webpack",
        "rsc-html-stream",
        "vite",
      ]) {
        const linkPath = path.join(fixtureRoot, "node_modules", packageName);
        const packagePath = [
          path.join(packageRoot, "node_modules", packageName),
          path.resolve(packageRoot, "../../examples/rsc-demo/node_modules", packageName),
        ].find((candidate) => existsSync(candidate));
        if (!packagePath) throw new Error(`Missing fixture dependency: ${packageName}`);
        mkdirSync(path.dirname(linkPath), { recursive: true });
        symlinkSync(
          realpathSync(packagePath),
          linkPath,
          process.platform === "win32" ? "junction" : "dir",
        );
      }

      const plugins = farmRsc({ routesDir: "" }).filter(
        (plugin) => plugin.name !== "@farm.js/plugin/rsc:nitro-build",
      );
      plugins.push(
        ...viteRsc({
          serverHandler: false,
          entries: {
            rsc: "./.farm/rsc-entries/entry.rsc.tsx",
            ssr: "./.farm/rsc-entries/entry.ssr.tsx",
            client: "./.farm/rsc-entries/entry.browser.tsx",
          },
        }),
      );
      const builder = await createBuilder({
        root: fixtureRoot,
        configFile: false,
        logLevel: "silent",
        srcDir: "src",
        outDir: "dist",
        esbuild: { jsxDev: false },
        experimental: { serverComponents: true, serverActions: true },
        build: { sourcemap: true },
        plugins,
      } as never);
      await builder.buildApp();

      const clientFiles = filesUnder(path.join(fixtureRoot, "dist", "client"));
      const clientScripts = clientFiles.filter((file) => file.endsWith(".js"));
      expect(clientScripts.length).toBeGreaterThan(0);
      expect(clientFiles.filter((file) => file.endsWith(".map"))).toEqual([]);
      for (const script of clientScripts) {
        // The trailing comment that points browsers (and anyone else) at the
        // map. React's bundle has the same text inside a string literal.
        const linksMap = /\n\/\/# sourceMappingURL=[^\n]*\s*$/.test(readFileSync(script, "utf8"));
        expect(linksMap, script).toBe(false);
      }
      const privateMaps = filesUnder(path.join(fixtureRoot, "dist", "client-sourcemaps"));
      expect(privateMaps.length).toBeGreaterThan(0);
      expect(privateMaps.every((file) => file.endsWith(".map"))).toBe(true);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps the map Vite writes after it starts the entry with its preload map", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-rsc-client-sourcemaps-preload-"));
    try {
      // The router and the island share a module the entry does not load, so the entry's dynamic
      // imports preload it and Vite puts its preload map on the entry's first line, then rewrites
      // the entry's map in the bundle.
      writeFileSync(
        path.join(fixtureRoot, "shared.mjs"),
        "export const twice = (value) => value * 2;\n",
      );
      writeFileSync(
        path.join(fixtureRoot, "entry.mjs"),
        'window.loadRouter = () => import("./router.mjs");\n' +
          'window.loadIsland = () => import("./island.mjs");\n',
      );
      writeFileSync(
        path.join(fixtureRoot, "router.mjs"),
        'import { twice } from "./shared.mjs";\nexport const navigate = (to) => twice(to);\n',
      );
      writeFileSync(
        path.join(fixtureRoot, "island.mjs"),
        'import { twice } from "./shared.mjs";\nexport default () => twice(3);\n',
      );
      const config = (plugins: ReturnType<typeof rscPrivateClientSourcemaps>[]) => ({
        root: fixtureRoot,
        configFile: false as const,
        logLevel: "silent" as const,
        plugins,
        build: {
          outDir: path.join(fixtureRoot, "dist", "client"),
          sourcemap: "hidden" as const,
          modulePreload: { polyfill: false },
          rollupOptions: {
            input: { index: path.join(fixtureRoot, "entry.mjs") },
            output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name].js" },
          },
        },
      });
      // The map Vite itself produces for the entry, from the same build without the plugin.
      const plain = await build({ ...config([]), build: { ...config([]).build, write: false } });
      const outputs = (Array.isArray(plain) ? plain[0] : plain) as {
        output: Array<{ fileName: string; type: string; source?: string | Uint8Array }>;
      };
      const viteMap = outputs.output.find((file) => file.fileName === "index.js.map");
      expect(viteMap?.type).toBe("asset");

      await build(config([rscPrivateClientSourcemaps()]));
      const code = readFileSync(path.join(fixtureRoot, "dist", "client", "index.js"), "utf8");
      expect(code.startsWith("const __vite__mapDeps=")).toBe(true);
      expect(
        filesUnder(path.join(fixtureRoot, "dist", "client")).filter((file) =>
          file.endsWith(".map"),
        ),
      ).toEqual([]);
      expect(
        readFileSync(path.join(fixtureRoot, "dist", "client-sourcemaps", "index.js.map"), "utf8"),
      ).toBe(String(viteMap?.source));
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
