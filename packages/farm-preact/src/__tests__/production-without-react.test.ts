// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../../../farm/src/build";
import { loadConfig, resolveConfig } from "../../../farm/src/config";
import { startProductionServer } from "../../../farm/src/__tests__/production-server";

/**
 * Farm's navigation helpers and hooks import react, and Preact runs them on preact/compat. Node
 * loaded them from an external @farm.js/core and the server bundle kept the import bare, so a
 * Preact app without React installed failed `farm build` (and answered 500 in `farm dev`) with
 * "Cannot find package 'react'" once a page called notFound() or used a hook from
 * `@farm.js/preact/bindings`. In this repository React resolves from Farm's own node_modules, so
 * the test reads the server output for a bare react import instead.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const coreRoot = path.resolve(packageRoot, "../farm");
const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  // Newest first, so the server stops before its directory is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-without-react-"));
  cleanups.push(() =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const link = async (name: string, target: string) => {
    const destination = path.join(root, "node_modules", ...name.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.symlink(await fs.realpath(target), destination, "junction");
  };
  await link("@farm.js/core", coreRoot);
  await link("@farm.js/preact", packageRoot);
  await link("preact", path.join(packageRoot, "node_modules", "preact"));
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `import { preact } from "@farm.js/preact";
export default { renderer: preact(), images: { provider: "none" }, telemetry: false };
`,
    "src/app/layout.tsx": `export default function Layout({ children }: { children: unknown }) {
  return <div id="shell">{children as never}</div>;
}
`,
    "src/app/page.tsx": `export default function Home() {
  return <p>home</p>;
}
`,
    "src/app/missing/page.tsx": `import { notFound } from "@farm.js/core/navigation";
export default function Missing(): never {
  notFound();
}
`,
    "src/app/moved/page.tsx": `import { redirect } from "@farm.js/core/navigation";
export default function Moved(): never {
  redirect("/router");
}
`,
    "src/app/not-found.tsx": `export default function NotFound() {
  return <h1 id="not-found">not found page</h1>;
}
`,
    "src/app/router/page.tsx": `"use client";
import { useRouter } from "@farm.js/preact/bindings";
export default function RouterPage() {
  const router = useRouter();
  return <p id="router">{typeof router.push}</p>;
}
`,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

async function readModules(directory: string): Promise<Array<[string, string]>> {
  const modules: Array<[string, string]> = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.[cm]?js$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (file.split(path.sep).includes("node_modules")) continue;
    modules.push([path.relative(directory, file), await fs.readFile(file, "utf8")]);
  }
  return modules;
}

const BARE_REACT_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']react(?:-dom)?(?:\/[\w-]+)?["']/;

describe("a Preact app in production", () => {
  it("runs Farm's navigation helpers and hooks on preact/compat", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const output = path.join(root, ".farm", ".output", "server");

    const reactImports = (await readModules(output)).flatMap(([file, code]) => {
      const match = BARE_REACT_IMPORT.exec(code);
      return match
        ? [`${file}: ${code.slice(Math.max(0, match.index - 80), match.index + 40)}`]
        : [];
    });
    expect(reactImports).toEqual([]);

    const server = await startProductionServer(output);
    cleanups.push(() => server.stop());
    const missing = await fetch(`${server.origin}/missing`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('<h1 id="not-found">not found page</h1>');
    const moved = await fetch(`${server.origin}/moved`, { redirect: "manual" });
    expect(moved.status).toBe(307);
    expect(new URL(moved.headers.get("location")!, server.origin).pathname).toBe("/router");
    const router = await fetch(`${server.origin}/router`);
    expect(router.status).toBe(200);
    expect(await router.text()).toContain('<p id="router">function</p>');
  }, 240_000);
});
