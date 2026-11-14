// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

// A build loads route modules through its own Vite server while the bundles build (the route
// runtime manifest, SSG). A module-entry package such as lucide-react loads there pre-bundled, as
// in `farm dev`: unbundled, its barrel is one module per icon through the module runner.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ICON_COUNT = 40;

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
}

/** An app whose page imports icon-kit, shaped like lucide-react (see development-ssr-prebundle). */
async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-build-ssr-prebundle-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const icons: Record<string, string> = {};
  for (let index = 0; index < ICON_COUNT; index++) {
    icons[`node_modules/icon-kit/dist/esm/icons/icon-${index}.mjs`] =
      `import { createElement, useId } from "react";
export default function Icon${index}() {
  return createElement("svg", { "data-icon": ${index}, "data-id": useId() });
}
`;
  }
  await writeFiles(root, {
    "package.json": '{"private":true,"type":"module"}',
    "farm.config.ts": "export default { telemetry: false, images: { provider: 'none' } };\n",
    "node_modules/icon-kit/package.json": JSON.stringify({
      name: "icon-kit",
      main: "dist/cjs/index.js",
      module: "dist/esm/index.mjs",
      sideEffects: false,
    }),
    "node_modules/icon-kit/dist/cjs/index.js": "module.exports = { cjs: true };\n",
    "node_modules/icon-kit/dist/esm/index.mjs": Object.keys(icons)
      .map((_, index) => `export { default as Icon${index} } from "./icons/icon-${index}.mjs";`)
      .join("\n"),
    ...icons,
    "src/app/layout.tsx":
      "export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }",
    "src/app/page.tsx": `import { Icon3 } from "icon-kit";
export default function Page() { return <main><Icon3 /></main>; }
`,
  });
  return root;
}

async function fetchFromProductionServer(serverDir: string, pathname: string): Promise<string> {
  const server = await startProductionServer(serverDir);
  try {
    const response = await fetch(`${server.origin}${pathname}`);
    expect(response.status, server.output()).toBe(200);
    return await response.text();
  } finally {
    await server.stop();
  }
}

describe("build SSR pre-bundling", () => {
  it("loads route modules' module-entry packages pre-bundled, in a cache of its own", async () => {
    const root = await createFixture();
    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });

      const viteCache = path.join(root, "node_modules", ".vite");
      // The route runtime manifest loaded the page, and with it icon-kit as one bundle.
      await expect(
        fs.access(path.join(viteCache, "farm-build", "deps_ssr", "icon-kit.js")),
      ).resolves.toBeUndefined();
      // `farm dev` keeps its own cache: Vite keys it on the mode, so sharing one would rebuild it.
      await expect(fs.access(path.join(viteCache, "deps_ssr"))).rejects.toThrow();

      // The server build bundles icon-kit as before, and the page renders through the app's React.
      const html = await fetchFromProductionServer(
        path.join(root, ".farm", ".output", "server"),
        "/",
      );
      expect(html).toMatch(/<svg data-icon="3" data-id="[^"]+"/);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 180_000);
});
