// @vitest-environment node
import fs from "fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import {
  FARM_OPTIMIZED_PACKAGE_IMPORTS,
  farmPackageImportsPlugin,
  readFarmPackageBarrel,
  resolveFarmOptimizedPackageImports,
  rewriteFarmPackageImports,
} from "../package-imports";

const roots: string[] = [];
const servers: ViteDevServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, files: Record<string, string>) {
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents);
  }
}

// An icon package in the shape of lucide-react: an entry that re-exports one module per icon,
// an `export *` sub-barrel, a namespace re-export, and `sideEffects: false`.
function iconPackage(root: string, manifest: Record<string, unknown> = {}) {
  write(root, {
    "node_modules/icons/package.json": JSON.stringify({
      name: "icons",
      sideEffects: false,
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          module: "./dist/index.mjs",
          node: "./dist/index.cjs",
          import: "./dist/index.mjs",
        },
      },
      ...manifest,
    }),
    "node_modules/icons/dist/index.mjs": [
      "import * as index from './icons/index.mjs';",
      "export { index as icons };",
      "export { default as Zap, default as ZapIcon } from './icons/zap.mjs';",
      "export * from './icons/index.mjs';",
      "export { createIcon } from './create-icon.mjs';",
    ].join("\n"),
    "node_modules/icons/dist/icons/index.mjs":
      "export { default as Sun } from './sun.mjs';\nexport { default as Moon } from './moon.mjs';\n",
    "node_modules/icons/dist/icons/zap.mjs": "export default 'zap';\n",
    "node_modules/icons/dist/icons/sun.mjs": "export default 'sun';\n",
    "node_modules/icons/dist/icons/moon.mjs":
      "globalThis.__moonLoaded = true;\nexport default 'moon';\n",
    "node_modules/icons/dist/create-icon.mjs": "export const createIcon = (n) => n;\n",
  });
  return fs.realpathSync(path.join(root, "node_modules/icons"));
}

function tempRoot() {
  const root = fs.realpathSync(mkdtempSync(path.join(tmpdir(), "farm-package-imports-")));
  roots.push(root);
  return root;
}

describe("readFarmPackageBarrel", () => {
  it("maps every export of a re-export barrel to its module", () => {
    const root = tempRoot();
    const dir = iconPackage(root);
    const barrel = readFarmPackageBarrel(root, "icons")!;
    expect(barrel.get("Zap")).toEqual({
      file: path.join(dir, "dist/icons/zap.mjs"),
      name: "default",
    });
    expect(barrel.get("ZapIcon")).toEqual({
      file: path.join(dir, "dist/icons/zap.mjs"),
      name: "default",
    });
    expect(barrel.get("Moon")).toEqual({
      file: path.join(dir, "dist/icons/moon.mjs"),
      name: "default",
    });
    expect(barrel.get("createIcon")).toEqual({
      file: path.join(dir, "dist/create-icon.mjs"),
      name: "createIcon",
    });
    expect(barrel.get("icons")).toEqual({
      file: path.join(dir, "dist/icons/index.mjs"),
      name: "*",
    });
  });

  it("leaves a package alone when its entry is CommonJS, ambiguous between environments, or impure with side effects", () => {
    const cjs = tempRoot();
    iconPackage(cjs, { exports: undefined, main: "./dist/index.cjs" });
    expect(readFarmPackageBarrel(cjs, "icons")).toBeNull();

    const browser = tempRoot();
    iconPackage(browser, {
      exports: { ".": { browser: "./dist/browser.mjs", import: "./dist/index.mjs" } },
    });
    expect(readFarmPackageBarrel(browser, "icons")).toBeNull();

    const node = tempRoot();
    iconPackage(node, {
      exports: { ".": { node: "./dist/index.cjs", import: "./dist/index.mjs" } },
    });
    expect(readFarmPackageBarrel(node, "icons")).toBeNull();

    const impure = tempRoot();
    iconPackage(impure, { sideEffects: undefined });
    write(impure, {
      "node_modules/icons/dist/index.mjs":
        "export { default as Zap } from './icons/zap.mjs';\nexport const version = '1';\n",
    });
    expect(readFarmPackageBarrel(impure, "icons")).toBeNull();
    // The same local export is fine once the package declares it has no side effects.
    const pure = tempRoot();
    iconPackage(pure);
    write(pure, {
      "node_modules/icons/dist/index.mjs":
        "export { default as Zap } from './icons/zap.mjs';\nexport const version = '1';\n",
    });
    expect(readFarmPackageBarrel(pure, "icons")?.get("Zap")?.name).toBe("default");
    expect(readFarmPackageBarrel(pure, "icons")?.has("version")).toBe(false);
  });

  it("is not installed: no rewrite", () => {
    expect(readFarmPackageBarrel(tempRoot(), "icons")).toBeNull();
  });
});

describe("rewriteFarmPackageImports", () => {
  it("imports the deep modules and keeps names the barrel does not re-export on the package", () => {
    const root = tempRoot();
    const dir = iconPackage(root);
    const code = [
      'import { Zap, Sun as SunIcon, version } from "icons";',
      "import { other } from 'elsewhere';",
      'import type { Props } from "icons";',
      "export const a = [Zap, SunIcon, version, other];",
    ].join("\n");
    const out = rewriteFarmPackageImports(code, new Set(["icons"]), (name) =>
      readFarmPackageBarrel(root, name),
    );
    // Deep imports are written with forward slashes on every platform.
    const posix = dir.split(path.sep).join("/");
    expect(out).toBe(
      [
        `import Zap from "${posix}/dist/icons/zap.mjs"; import SunIcon from "${posix}/dist/icons/sun.mjs"; import { version } from "icons";`,
        "import { other } from 'elsewhere';",
        'import type { Props } from "icons";',
        "export const a = [Zap, SunIcon, version, other];",
      ].join("\n"),
    );
  });

  it("returns null when nothing changes", () => {
    const root = tempRoot();
    iconPackage(root);
    expect(
      rewriteFarmPackageImports('import x from "icons";', new Set(["icons"]), (n) =>
        readFarmPackageBarrel(root, n),
      ),
    ).toBeNull();
    expect(
      rewriteFarmPackageImports('import { Zap } from "other";', new Set(["icons"]), () => null),
    ).toBeNull();
  });
});

describe("resolveFarmOptimizedPackageImports", () => {
  it("adds the app's packages to the defaults and turns off with false", () => {
    expect(resolveFarmOptimizedPackageImports(["@acme/icons"]).has("@acme/icons")).toBe(true);
    expect(resolveFarmOptimizedPackageImports(undefined).has("lucide-react")).toBe(true);
    expect(resolveFarmOptimizedPackageImports(false).size).toBe(0);
    expect(FARM_OPTIMIZED_PACKAGE_IMPORTS).toContain("react-icons/fa");
  });
});

describe("farmPackageImportsPlugin in a Vite dev server", () => {
  it("loads only the icon a module imports, not the package's barrel", async () => {
    const root = tempRoot();
    const dir = iconPackage(root);
    write(root, {
      "package.json": '{"name":"app","type":"module"}',
      "src/entry.js": 'import { Zap } from "icons";\nexport const zap = Zap;\n',
    });
    const server = await createServer({
      root,
      logLevel: "silent",
      configFile: false,
      server: { middlewareMode: true, watch: null },
      resolve: { noExternal: true },
      plugins: [farmPackageImportsPlugin({ root, packages: new Set(["icons"]) })],
    });
    servers.push(server);
    const loaded = await server.ssrLoadModule("/src/entry.js");
    expect(loaded.zap).toBe("zap");
    // Vite keys its module graph by forward-slash paths on every platform.
    const posix = dir.split(path.sep).join("/");
    const files = [...server.environments.ssr.moduleGraph.idToModuleMap.keys()].filter((id) =>
      id.startsWith(posix),
    );
    expect(files).toEqual([`${posix}/dist/icons/zap.mjs`]);
    // The browser keeps the package import, which Vite serves from its pre-bundle.
    const browser = await server.environments.client.transformRequest("/src/entry.js");
    expect(browser?.code).toMatch(/from "\/node_modules\/\.vite\/deps\/icons\.js|from "icons"/);
    expect(browser?.code).not.toContain("zap.mjs");
  });
});
