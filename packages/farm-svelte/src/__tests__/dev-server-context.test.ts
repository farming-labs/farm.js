// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { startProductionServer } from "../../../farm/src/__tests__/production-server";
import { build } from "../../../farm/src/build";
import { loadConfig, resolveConfig } from "../../../farm/src/config";
import { createServer } from "../../../farm/src/server/create-server";

/**
 * In development, vite-plugin-svelte pre-bundled `svelte` for server rendering, so pages ran on
 * that copy while the adapter's server renderer ran on Svelte's own modules. A layout's
 * setContext() and a page's getContext() then used different runtimes, and the page threw
 * `lifecycle_outside_component`: a 500 in development, while the production build rendered it.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const coreRoot = path.resolve(packageRoot, "../farm");
const roots: string[] = [];
const servers: ViteDevServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

const files: Record<string, string> = {
  "package.json": '{"type":"module","private":true}',
  "farm.config.ts": `import { svelte } from "@farm.js/svelte";

export default { renderer: svelte(), images: { provider: "none" }, telemetry: false };
`,
  "src/app/layout.svelte": `<script>
  import { setContext } from "svelte";
  let { children } = $props();
  setContext("label", "from the layout");
</script>

<main>{@render children?.()}</main>
`,
  "src/app/page.svelte": `<script>
  import { getContext } from "svelte";
  const label = getContext("label") ?? "missing";
</script>

<p id="label">{label}</p>
`,
};

async function createApp(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-svelte-context-")));
  roots.push(root);
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  const link = async (name: string, target: string) => {
    const destination = path.join(root, "node_modules", ...name.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.symlink(await fs.realpath(target), destination, "junction");
  };
  await link("@farm.js/core", coreRoot);
  await link("@farm.js/svelte", packageRoot);
  await link("svelte", path.join(packageRoot, "node_modules", "svelte"));
  return root;
}

describe("Svelte context in server rendering", () => {
  it("reaches a page from its layout in development", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "development")), root },
      "development",
    );
    const server = await createServer(config as never);
    servers.push(server);
    await server.listen(0);
    const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, "");

    await expectLayoutContext(origin);
  }, 60_000);

  it("reaches a page from its layout in production", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    try {
      await expectLayoutContext(server.origin);
    } finally {
      await server.stop();
    }
  }, 180_000);
});

async function expectLayoutContext(origin: string): Promise<void> {
  const response = await fetch(`${origin}/`);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain('<p id="label">from the layout</p>');
}
