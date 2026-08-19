// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

describe("Farm config resolution plugin", () => {
  type OnResolveArgs = {
    path: string;
    importer: string;
    namespace: string;
    resolveDir: string;
    kind: string;
    pluginData?: Record<string, unknown>;
  };
  type OnResolveCallback = (args: OnResolveArgs) => Promise<unknown>;

  async function resolveWithPlugin(args: OnResolveArgs): Promise<unknown> {
    const callbacks: Array<{ filter: RegExp; callback: OnResolveCallback }> = [];
    const pluginBuild = {
      onResolve(options: { filter: RegExp }, callback: OnResolveCallback) {
        callbacks.push({ filter: options.filter, callback });
      },
      async resolve(specifier: string) {
        return { path: `/resolved/${specifier}`, errors: [], warnings: [] };
      },
    };

    const plugin = createFarmConfigResolutionPlugin({
      transform: async () => ({ code: "", map: "", warnings: [] }),
    });
    plugin.setup(pluginBuild as never);

    for (const { filter, callback } of callbacks) {
      if (!filter.test(args.path)) continue;
      const result = await callback(args);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  it("does not mark Windows entry points as external", async () => {
    // Windows absolute paths match the bare-specifier filter (/^[^./]/); the
    // entry point must not be externalized or esbuild fails with
    // "The entry point ... cannot be marked as external".
    await expect(
      resolveWithPlugin({
        path: "E:\\farming\\stacklens\\farm.config.ts",
        importer: "",
        namespace: "file",
        resolveDir: "",
        kind: "entry-point",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not externalize Windows absolute import paths", async () => {
    for (const importPath of [
      "E:\\farming\\stacklens\\shared-config.ts",
      "E:/farming/stacklens/shared-config.ts",
      "\\\\server\\share\\shared-config.ts",
    ]) {
      await expect(
        resolveWithPlugin({
          path: importPath,
          importer: "E:\\farming\\stacklens\\farm.config.ts",
          namespace: "file",
          resolveDir: "E:\\farming\\stacklens",
          kind: "import-statement",
        }),
      ).resolves.toBeUndefined();
    }
  });

  it("still externalizes bare package specifiers", async () => {
    await expect(
      resolveWithPlugin({
        path: "picocolors",
        importer: "/project/farm.config.ts",
        namespace: "file",
        resolveDir: "/project",
        kind: "import-statement",
      }),
    ).resolves.toMatchObject({ external: true, path: "/resolved/picocolors" });
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

async function loadProjectConfig(root: string): Promise<Record<string, unknown>> {
  return loadFarmConfigFile(path.join(root, "farm.config.ts"), { root });
}
