// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadFarmConfigFile } from "../layers";

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
