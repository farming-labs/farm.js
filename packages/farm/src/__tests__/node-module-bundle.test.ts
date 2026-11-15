// @vitest-environment node

import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { bundleNodeModule } from "../build/node-module-bundle";
import { minifyFarmServerChunk } from "../nitro/universal-build";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

async function createRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "farm-node-bundle-")));
  temporaryRoots.add(root);
  return root;
}

describe("bundleNodeModule", () => {
  it("bundles tsconfig path aliases and leaves packages external", async () => {
    const root = await createRoot();
    await mkdir(path.join(root, "src", "lib"), { recursive: true });
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    await writeFile(path.join(root, "src", "lib", "value.ts"), "export const value = 41;\n");
    await writeFile(
      path.join(root, "entry.tsx"),
      [
        'import { value } from "@/lib/value";',
        'import pc from "picocolors";',
        'import { readFileSync } from "node:fs";',
        "export default { value: value + 1, pc, readFileSync, element: <div /> };",
      ].join("\n"),
    );
    const outfile = path.join(root, "out.mjs");

    await bundleNodeModule({
      root,
      entry: path.join(root, "entry.tsx"),
      outfile,
      target: "node20",
      externalPackages: true,
    });

    const code = await readFile(outfile, "utf8");
    expect(code).toMatch(/\b4[12]\b/);
    expect(code).not.toContain("@/lib/value");
    expect(code).toMatch(/from ["']picocolors["']/);
    expect(code).toMatch(/from ["']node:fs["']/);
    expect(code).toMatch(/from ["']react\/jsx-runtime["']/);
    expect(code).toContain("sourceMappingURL=data:application/json");
  });

  it("keeps a workspace package external when tsconfig paths map it to declarations", async () => {
    const root = await createRoot();
    const packageRoot = path.join(root, "packages", "workspace-lib");
    await mkdir(path.join(packageRoot, "dist"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@farm.js/workspace-lib",
        type: "module",
        types: "./dist/index.d.ts",
        exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      }),
    );
    await writeFile(path.join(packageRoot, "dist", "index.js"), "export const value = 1;\n");
    await writeFile(
      path.join(packageRoot, "dist", "index.d.ts"),
      "export declare const value: number;\n",
    );
    await symlink(
      packageRoot,
      path.join(root, "node_modules", "@farm.js", "workspace-lib"),
      "junction",
    );
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@farm.js/workspace-lib": ["./packages/workspace-lib/dist/index.d.ts"] },
        },
      }),
    );
    await writeFile(
      path.join(root, "entry.ts"),
      'import { value } from "@farm.js/workspace-lib";\nexport default value;\n',
    );
    const outfile = path.join(root, "out.mjs");

    await bundleNodeModule({
      root,
      entry: path.join(root, "entry.ts"),
      outfile,
      target: "node20",
      externalPackages: true,
    });

    const code = await readFile(outfile, "utf8");
    expect(code).toMatch(/from ["']@farm\.js\/workspace-lib["']/);
    expect(code).not.toContain("index.d.ts");
    expect((await import(pathToFileURL(outfile).href)).default).toBe(1);
  });

  it("reports load errors as plain text", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "broken.ts"), "export default { a: 1 ;\n");

    const error = await bundleNodeModule({
      root,
      entry: path.join(root, "broken.ts"),
      outfile: path.join(root, "out.mjs"),
      target: "node20",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("broken.ts");
    expect((error as Error).message).not.toContain("\u001b[");
  });
});

describe("minifyFarmServerChunk", () => {
  const source = [
    "/*! legal notice */",
    "export function namedHandler() { const longLocalName = 'café'; return longLocalName; }",
    "export const Component = class NamedComponent {};",
    "export const arrow = () => namedHandler.name;",
  ].join("\n");

  it("keeps function and class names, drops legal comments, and emits ASCII", async () => {
    const code = await minifyFarmServerChunk(source, "chunk.mjs", {
      keepNames: true,
      target: "node18",
    });
    expect(code).not.toContain("legal notice");
    expect(code).not.toContain("longLocalName");
    expect(code).toMatch(/caf\\(?:u00e9|xe9)/i);
    expect([...code].every((character) => character.charCodeAt(0) < 128)).toBe(true);

    const module = await import(`data:text/javascript,${encodeURIComponent(code)}`);
    expect(module.namedHandler.name).toBe("namedHandler");
    expect(module.namedHandler()).toBe("café");
    expect(module.Component.name).toBe("NamedComponent");
    expect(module.arrow()).toBe("namedHandler");
  });

  it("does not add name helpers when names are not kept", async () => {
    const code = await minifyFarmServerChunk(source, "chunk.mjs", {
      keepNames: false,
      target: "esnext",
    });
    expect(code).not.toContain("__name");
    const module = await import(`data:text/javascript,${encodeURIComponent(code)}`);
    expect(module.namedHandler()).toBe("café");
  });

  it("emits import() and require() specifiers as string literals", async () => {
    // Miniflare/workerd and other static module scanners reject non-literal
    // specifiers, and Oxc prints the shortest quote (a backtick) by default.
    const code = await minifyFarmServerChunk(
      [
        'export const load = () => import("./_chunks/page-\u00e9.mjs");',
        'export const legacy = () => require("./legacy.cjs");',
        "export const label = `plain`;",
        'export const sample = "import(`./not-a-module.mjs`)";',
      ].join("\n"),
      "_virtual_farm-ssr-entry.mjs",
      { keepNames: true, target: "esnext" },
    );

    expect(code).toContain('import("./_chunks/page-\\u00e9.mjs")');
    expect(code).toContain('require("./legacy.cjs")');
    expect(code).not.toContain("import(`./_chunks");
    expect(code).not.toContain("require(`");
    expect(code).toContain("import(`./not-a-module.mjs`)");
    expect([...code].every((character) => character.charCodeAt(0) < 128)).toBe(true);
  });

  it("restores import() specifiers without require() calls, leaving other templates alone", async () => {
    // No require() here, so the module record handles every import().
    const code = await minifyFarmServerChunk(
      [
        'export const a = () => import("./_chunks/a.mjs");',
        "export const b = () => import('./_chunks/b.mjs');",
        "export const dynamic = (name) => import(`./_chunks/${name}.mjs`);",
        'export const sample = "import(`./not-a-module.mjs`)";',
        "export const label = `plain`;",
      ].join("\n"),
      "_virtual_farm-ssr-entry.mjs",
      { keepNames: true, target: "esnext" },
    );

    expect(code).toContain('import("./_chunks/a.mjs")');
    expect(code).toContain('import("./_chunks/b.mjs")');
    expect(code).not.toMatch(/import\(`\.\/_chunks\/[ab]\.mjs`\)/);
    // A template with a substitution is not a static specifier; it stays as is.
    expect(code).toMatch(/import\(`\.\/_chunks\/\$\{/);
    expect(code).toContain("import(`./not-a-module.mjs`)");
  });

  it("restores an import() the module record lists twice only once", async () => {
    // Oxc records this import() twice: the parenthesized destructuring is parsed
    // as a cover grammar first. Replacing the same span twice corrupted the chunk.
    const code = await minifyFarmServerChunk(
      'export async function load() { let i; try { ({ onFarmEvent: i } = await import("./_chunks/observability.mjs")); } catch {} return i; }',
      "_virtual_farm-ssr-entry.mjs",
      { keepNames: true, target: "esnext" },
    );

    expect(code.match(/import\("\.\/_chunks\/observability\.mjs"\)/g)).toHaveLength(1);
    const module = await import(`data:text/javascript,${encodeURIComponent(code)}`);
    expect(typeof module.load).toBe("function");
  });

  it("falls back to the AST for escaped import() specifiers", async () => {
    const code = await minifyFarmServerChunk(
      'export const load = () => import("./_chunks/page-\u00e9.mjs");',
      "_virtual_farm-ssr-entry.mjs",
      { keepNames: true, target: "esnext" },
    );

    expect(code).toContain('import("./_chunks/page-\\u00e9.mjs")');
    expect([...code].every((character) => character.charCodeAt(0) < 128)).toBe(true);
  });

  it("throws on syntax errors instead of emitting partial output", async () => {
    await expect(
      minifyFarmServerChunk("export const = ;", "broken.mjs", {
        keepNames: true,
        target: "esnext",
      }),
    ).rejects.toThrow("broken.mjs");
  });
});
