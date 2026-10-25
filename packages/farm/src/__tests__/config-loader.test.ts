// @vitest-environment node

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFarmConfigResolutionPlugin, loadFarmConfigFile } from "../layers";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe("Farm config helper import fast path", () => {
  it("loads defineConfig from the config-only entry", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "farm.config.ts"),
      [
        'import { defineConfig, type FarmUserConfig } from "@farm.js/core";',
        "const config = { srcDir: 'app' } satisfies FarmUserConfig;",
        "export default defineConfig(config);",
      ].join("\n"),
    );

    await expect(loadProjectConfig(root)).resolves.toEqual({
      helperEntry: "config",
      srcDir: "app",
    });
  });

  it("supports multiline helper imports and local aliases", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "farm.config.ts"),
      [
        "import {",
        "  type FarmUserConfig,",
        "  defineFarmConfig as configure,",
        '} from "@farm.js/core";',
        "const config = { distDir: '.output' } satisfies FarmUserConfig;",
        "export default configure(config);",
      ].join("\n"),
    );

    await expect(loadProjectConfig(root)).resolves.toEqual({
      distDir: ".output",
      helperEntry: "config",
    });
  });

  it("keeps the root entry when any other runtime export is imported", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "farm.config.ts"),
      [
        'import { defineConfig } from "@farm.js/core";',
        'import { runtimeValue } from "@farm.js/core";',
        "export default defineConfig({ runtimeValue });",
      ].join("\n"),
    );

    await expect(loadProjectConfig(root)).resolves.toEqual({
      helperEntry: "root",
      runtimeValue: "root-runtime",
    });
  });

  it("uses the config-only entry for helpers imported by transitive config modules", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "shared-config.ts"),
      [
        'import { defineConfig } from "@farm.js/core";',
        "export const sharedConfig = defineConfig({ extends: ['./base'] });",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "farm.config.ts"),
      ['import { sharedConfig } from "./shared-config";', "export default sharedConfig;"].join(
        "\n",
      ),
    );

    await expect(loadProjectConfig(root)).resolves.toEqual({
      extends: ["./base"],
      helperEntry: "config",
    });
  });
});

describe("Farm config workspace packages", () => {
  it("loads a symlinked workspace package that tsconfig paths map to its declarations", async () => {
    const root = await createProject();
    await createWorkspacePackage(root);
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
      path.join(root, "farm.config.ts"),
      [
        'import { workspaceValue } from "@farm.js/workspace-lib";',
        "export default { workspaceValue };",
      ].join("\n"),
    );

    await expect(loadProjectConfig(root)).resolves.toEqual({ workspaceValue: "runtime" });
  });
});

describe("Farm config resolution plugin", () => {
  type ResolveResult = { id: string; external?: boolean } | null;

  async function resolveWithPlugin(
    source: string,
    importer: string | undefined,
    options: { isEntry?: boolean; resolve?: (specifier: string) => ResolveResult } = {},
  ): Promise<unknown> {
    const plugin = createFarmConfigResolutionPlugin({
      transform: (async () => ({ code: "", errors: [], warnings: [] })) as never,
    });
    const context = {
      async resolve(specifier: string) {
        return options.resolve
          ? options.resolve(specifier)
          : { id: `/resolved/${specifier}`, external: false };
      },
    };
    const resolveId = plugin.resolveId as (
      this: typeof context,
      source: string,
      importer: string | undefined,
      extraOptions: { kind: string; isEntry: boolean },
    ) => Promise<unknown>;
    return resolveId.call(context, source, importer, {
      kind: options.isEntry ? "entry-point" : "import-statement",
      isEntry: options.isEntry ?? false,
    });
  }

  it("does not mark Windows entry points as external", async () => {
    // Windows absolute paths match the bare-specifier filter (/^[^./]/); the
    // entry point must not be externalized or the bundle has nothing to build.
    await expect(
      resolveWithPlugin("E:\\farming\\stacklens\\farm.config.ts", undefined, { isEntry: true }),
    ).resolves.toBeNull();
  });

  it("does not externalize Windows absolute import paths", async () => {
    for (const importPath of [
      "E:\\farming\\stacklens\\shared-config.ts",
      "E:/farming/stacklens/shared-config.ts",
      "\\\\server\\share\\shared-config.ts",
    ]) {
      await expect(
        resolveWithPlugin(importPath, "E:\\farming\\stacklens\\farm.config.ts"),
      ).resolves.toBeNull();
    }
  });

  it("externalizes bare package specifiers as file:// URLs", async () => {
    // Raw absolute paths are written verbatim into the compiled config's
    // import statements; on Windows, Node's ESM loader parses `E:\...` as a
    // URL with protocol "e:" and rejects it, so externals must be file:// URLs.
    await expect(resolveWithPlugin("picocolors", "/project/farm.config.ts")).resolves.toMatchObject(
      {
        external: true,
        id: pathToFileURL(path.resolve("/resolved/picocolors")).href,
      },
    );
  });

  it("keeps unresolvable bare specifiers external without rewriting them", async () => {
    await expect(
      resolveWithPlugin("some-missing-package", "/project/farm.config.ts", {
        resolve: () => null,
      }),
    ).resolves.toMatchObject({ external: true, id: "some-missing-package" });
  });

  it("leaves Node built-ins to the bundler", async () => {
    await expect(resolveWithPlugin("node:fs", "/project/farm.config.ts")).resolves.toBeNull();
    await expect(resolveWithPlugin("path", "/project/farm.config.ts")).resolves.toBeNull();
  });
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "farm-config-loader-"));
  temporaryRoots.add(root);

  const packageRoot = path.join(root, "node_modules", "@farm.js", "core");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@farm.js/core",
      version: "0.0.0-test",
      type: "module",
      exports: {
        ".": "./index.js",
        "./config": "./config.js",
      },
    }),
  );
  await writeFile(
    path.join(packageRoot, "index.js"),
    [
      'export const runtimeValue = "root-runtime";',
      'export const defineConfig = (config) => ({ helperEntry: "root", ...config });',
      "export const defineFarmConfig = defineConfig;",
    ].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "config.js"),
    [
      'export const defineConfig = (config) => ({ helperEntry: "config", ...config });',
      "export const defineFarmConfig = defineConfig;",
    ].join("\n"),
  );

  return root;
}

// A pnpm workspace package: linked into node_modules from outside it, with a
// `types` condition listed before `import` and a declaration file that cannot run.
async function createWorkspacePackage(root: string): Promise<void> {
  const packageRoot = path.join(root, "packages", "workspace-lib");
  await mkdir(path.join(packageRoot, "dist"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@farm.js/workspace-lib",
      type: "module",
      types: "./dist/index.d.ts",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    }),
  );
  await writeFile(
    path.join(packageRoot, "dist", "index.js"),
    'export const workspaceValue = "runtime";\n',
  );
  await writeFile(
    path.join(packageRoot, "dist", "index.d.ts"),
    "export declare const workspaceValue: string;\n",
  );
  await symlink(
    packageRoot,
    path.join(root, "node_modules", "@farm.js", "workspace-lib"),
    "junction",
  );
}

async function loadProjectConfig(root: string): Promise<Record<string, unknown>> {
  return loadFarmConfigFile(path.join(root, "farm.config.ts"), { root });
}
