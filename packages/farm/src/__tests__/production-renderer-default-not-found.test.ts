// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

/**
 * Farm's built-in not-found page is a plain function component. Renderers that compile their
 * own components render one only once it is marked, so a Vue or Svelte app without a not-found
 * page answered a production 404 with "[object Object]" where the page belongs.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packagesDir = path.dirname(packageRoot);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

const apps = {
  vue: {
    framework: "vue",
    files: {
      "src/app/layout.vue": `<template><div id="root-layout"><slot /></div></template>`,
      "src/app/page.vue": `<template><p>home</p></template>`,
    },
  },
  svelte: {
    framework: "svelte",
    files: {
      "src/app/layout.svelte": `<script>let { children } = $props();</script><div id="root-layout">{@render children?.()}</div>`,
      "src/app/page.svelte": `<p>home</p>`,
    },
  },
} as const;

async function createApp(renderer: keyof typeof apps): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, `.tmp-default-not-found-${renderer}-`));
  roots.push(root);
  const link = async (name: string, target: string) => {
    const destination = path.join(root, "node_modules", ...name.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.symlink(await fs.realpath(target), destination, "junction");
  };
  await link("@farm.js/core", packageRoot);
  await link(`@farm.js/${renderer}`, path.join(packagesDir, `farm-${renderer}`));
  await link(
    apps[renderer].framework,
    path.join(packagesDir, `farm-${renderer}`, "node_modules", apps[renderer].framework),
  );
  for (const name of ["react", "react-dom"]) {
    await link(name, path.join(packageRoot, "node_modules", name));
  }
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `import { ${renderer} } from "@farm.js/${renderer}";
export default { renderer: ${renderer}(), images: { provider: "none" }, telemetry: false };`,
    ...apps[renderer].files,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

describe("Farm's not-found page in a production build", () => {
  it.each(["vue", "svelte"] as const)(
    "renders for a %s app without a not-found page",
    async (renderer) => {
      const root = await createApp(renderer);
      const config = await resolveConfig(
        { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
      try {
        const response = await fetch(`${server.origin}/missing`);
        const html = await response.text();
        expect(response.status).toBe(404);
        expect(html).toContain("farm-default-not-found");
        expect(html).toContain("GO HOME");
        expect(html).not.toContain("[object Object]");
      } finally {
        await server.stop();
      }
    },
    240_000,
  );
});
