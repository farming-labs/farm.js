// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig, resolveDocsConfig } from "../config";
import {
  applyFarmDocsFrameworkAutoDetection,
  resetFarmDocsFrameworkDetectionNotices,
} from "../docs/framework-detect";

const tempDirs: string[] = [];

async function createAppDir(options: { declareFramework?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "farm-docs-detect-"));
  tempDirs.push(dir);
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "fixture-app",
      ...(options.declareFramework ? { dependencies: { "@farming-labs/farmjs": "^0.2.111" } } : {}),
    }),
  );
  return dir;
}

/**
 * Install a fake @farming-labs/farmjs whose config entry mirrors the real
 * withDocs(): prepend a Vite plugin and stamp the adapter descriptor.
 */
async function installFramework(
  appDir: string,
  options: { configSource?: string } = {},
): Promise<void> {
  const packageDir = path.join(appDir, "node_modules", "@farming-labs", "farmjs");
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: "@farming-labs/farmjs",
      version: "0.2.111",
      type: "module",
      exports: { "./config": "./config.js" },
    }),
  );
  const source =
    options.configSource ??
    `const farmDocsRuntimeAdapter = {
  id: "@farming-labs/farmjs",
  protocol: 1,
  server: "@farming-labs/farmjs/server",
  react: "@farming-labs/farmjs/react",
  vite: "@farming-labs/farmjs/vite",
};
export function withDocs(farmConfig, options = {}) {
  const existing =
    !farmConfig.docs || farmConfig.docs === true ? {} : farmConfig.docs;
  const vite = farmConfig.vite ?? {};
  return {
    ...farmConfig,
    vite: {
      ...vite,
      plugins: [{ name: "farmjs-docs-mdx" }, ...(vite.plugins ?? [])],
    },
    docs: { ...existing, enabled: true, adapter: farmDocsRuntimeAdapter },
  };
}
`;
  await writeFile(path.join(packageDir, "config.js"), source);
}

function detectionLoggers() {
  return { log: vi.fn(), warn: vi.fn() };
}

beforeEach(() => {
  resetFarmDocsFrameworkDetectionNotices();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("docs framework auto-detection", () => {
  it("applies the framework's withDocs when the package is installed", async () => {
    const root = await createAppDir({ declareFramework: true });
    await installFramework(root);
    const { log, warn } = detectionLoggers();

    const applied = await applyFarmDocsFrameworkAutoDetection(
      { root, docs: { entry: "/handbook" }, vite: { plugins: [{ name: "app-plugin" }] } } as any,
      { root, log, warn },
    );

    expect(applied.docs.adapter).toMatchObject({
      id: "@farming-labs/farmjs",
      protocol: 1,
      server: "@farming-labs/farmjs/server",
      react: "@farming-labs/farmjs/react",
    });
    // Existing docs options and vite plugins survive, MDX plugin is prepended.
    expect(applied.docs.entry).toBe("/handbook");
    expect((applied.vite as any).plugins.map((plugin: any) => plugin.name)).toEqual([
      "farmjs-docs-mdx",
      "app-plugin",
    ]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves configs with an explicit adapter or opt-out untouched", async () => {
    const root = await createAppDir({ declareFramework: true });
    await installFramework(root);
    const { log, warn } = detectionLoggers();
    const explicitAdapter = {
      id: "custom",
      protocol: 1,
      server: "custom/server",
      react: "custom/react",
    };

    const withExplicit = { root, docs: { adapter: explicitAdapter } } as any;
    expect(await applyFarmDocsFrameworkAutoDetection(withExplicit, { root, log, warn })).toBe(
      withExplicit,
    );

    const optedOut = { root, docs: { adapter: false } } as any;
    expect(await applyFarmDocsFrameworkAutoDetection(optedOut, { root, log, warn })).toBe(optedOut);

    const disabled = { root, docs: false } as any;
    expect(await applyFarmDocsFrameworkAutoDetection(disabled, { root, log, warn })).toBe(disabled);

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to the embedded renderer with a one-time notice when not installed", async () => {
    const root = await createAppDir();
    const { log, warn } = detectionLoggers();
    const config = { root, docs: {} } as any;

    const detect = () => applyFarmDocsFrameworkAutoDetection(config, { root, log, warn });
    expect(await detect()).toBe(config);
    expect(await detect()).toBe(config);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("@farming-labs/farmjs");
    expect(warn.mock.calls[0][0]).toContain("docs.adapter = false");
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps the embedded renderer when the installed adapter protocol is unsupported", async () => {
    const root = await createAppDir({ declareFramework: true });
    await installFramework(root, {
      configSource: `export function withDocs(farmConfig) {
  return {
    ...farmConfig,
    docs: {
      enabled: true,
      adapter: { id: "@farming-labs/farmjs", protocol: 2, server: "x", react: "y" },
    },
  };
}
`,
    });
    const { log, warn } = detectionLoggers();
    const config = { root, docs: {} } as any;

    expect(await applyFarmDocsFrameworkAutoDetection(config, { root, log, warn })).toBe(config);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("protocol 1");
  });

  it("survives a framework config entry that throws", async () => {
    const root = await createAppDir({ declareFramework: true });
    await installFramework(root, {
      configSource: `throw new Error("framework exploded");
`,
    });
    const { log, warn } = detectionLoggers();
    const config = { root, docs: {} } as any;

    expect(await applyFarmDocsFrameworkAutoDetection(config, { root, log, warn })).toBe(config);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("framework exploded");
  });
});

describe("resolveConfig docs delegation (#483 phase 1)", () => {
  it("resolves docs: {} to the framework adapter when installed", async () => {
    const root = await createAppDir({ declareFramework: true });
    await installFramework(root);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const resolved = await resolveConfig({ root, docs: {} } as any, "development");

    expect(resolved.docs.enabled).toBe(true);
    expect(resolved.docs.adapter).toMatchObject({
      protocol: 1,
      server: "@farming-labs/farmjs/server",
      react: "@farming-labs/farmjs/react",
    });
    expect((resolved.vite as any).plugins?.[0]?.name).toBe("farmjs-docs-mdx");
  });

  it("keeps the embedded handler for non-React renderers even when installed", async () => {
    const root = await createAppDir({ declareFramework: true });
    await installFramework(root);
    const { warn } = detectionLoggers();
    vi.spyOn(console, "warn").mockImplementation(warn);

    const resolved = await resolveConfig(
      {
        root,
        docs: {},
        renderer: {
          name: "svelte",
          vite: "@farm.js/svelte/vite",
          server: "@farm.js/svelte/server",
          client: "@farm.js/svelte/client",
        },
      } as any,
      "development",
    );

    expect(resolved.docs.enabled).toBe(true);
    expect(resolved.docs.adapter).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats docs.adapter = false as the embedded renderer without notices", async () => {
    const root = await createAppDir({ declareFramework: true });
    await installFramework(root);
    const { warn } = detectionLoggers();
    vi.spyOn(console, "warn").mockImplementation(warn);

    const resolved = await resolveConfig({ root, docs: { adapter: false } } as any, "development");

    expect(resolved.docs.enabled).toBe(true);
    expect(resolved.docs.adapter).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();

    const docsOnly = await resolveDocsConfig({ adapter: false }, { root });
    expect(docsOnly.enabled).toBe(true);
    expect(docsOnly.adapter).toBeUndefined();
  });
});
