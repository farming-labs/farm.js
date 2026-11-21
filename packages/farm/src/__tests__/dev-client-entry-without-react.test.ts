// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init, parse } from "es-module-lexer";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../server/create-server";

/**
 * React is an optional peer of @farm.js/core, and create-farm-app leaves it out of Preact, Solid,
 * Vue, and Svelte apps. The development client entry imported its router from
 * @farm.js/core/client, whose module graph imports react, so such an app never hydrated in
 * development while its production build, which uses the internal client runtime, worked.
 *
 * The monorepo cannot reproduce a missing React (core's own node_modules has it), so this walks
 * the static imports the browser would link, through the built files Vite prebundles.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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

const renderer = {
  name: "plain",
  vite: "plain-renderer/vite",
  server: "plain-renderer/server",
  client: "plain-renderer/client",
};

const runtime = `export const Fragment = Symbol.for("plain.fragment");
export function Suspense(props) { return props.children; }
export function createElement(type, props, ...children) {
  return { type, props: { ...props, children } };
}
export function isValidElement(value) { return typeof value === "object" && value !== null; }
export default { Fragment, Suspense, createElement, isValidElement };
`;

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-dev-client-without-react-"));
  roots.push(root);
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "src/app/page.js": 'export default function Page() { return "home"; }\n',
    "node_modules/plain-renderer/package.json": JSON.stringify({
      name: "plain-renderer",
      type: "module",
      exports: { "./server": "./server.js", "./client": "./client.js", "./vite": "./vite.js" },
    }),
    "node_modules/plain-renderer/server.js": `${runtime}export const name = "plain";
export function renderToString() { return ""; }
`,
    "node_modules/plain-renderer/client.js": `${runtime}export function createRoot() { return { render() {}, unmount() {} }; }
export function hydrateRoot() { return createRoot(); }
`,
    "node_modules/plain-renderer/vite.js":
      "export function createFarmRendererPlugin() { return []; }\n",
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

/** The built ESM file a `@farm.js/core/...` specifier resolves to through the package exports. */
async function resolveCoreEntry(specifier: string): Promise<string> {
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  const subpath = `.${specifier.slice("@farm.js/core".length)}`;
  const target = manifest.exports[subpath]?.import;
  if (typeof target !== "string") throw new Error(`No ESM export for ${specifier}`);
  return path.join(packageRoot, target);
}

/** Every bare specifier the browser links, statically, from `entry`. */
async function staticBareImports(entry: string): Promise<Map<string, string>> {
  const bare = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const [imports] = parse(await fs.readFile(file, "utf8"));
    for (const entryImport of imports) {
      // Dynamic imports load on demand; only static ones are linked before the module runs.
      if (entryImport.d !== -1 || !entryImport.n) continue;
      if (entryImport.n.startsWith("."))
        queue.push(path.resolve(path.dirname(file), entryImport.n));
      else if (!bare.has(entryImport.n)) bare.set(entryImport.n, path.relative(packageRoot, file));
    }
  }
  return bare;
}

describe("the development client entry of a non-React app", () => {
  it("links no React module", async () => {
    const root = await createApp();
    const server = await createServer({ root, renderer, images: { provider: "none" } });
    servers.push(server);

    const loaded = await server.environments.client.pluginContainer.load("/@farm/client");
    const entry = typeof loaded === "string" ? loaded : (loaded?.code ?? "");
    await init;
    const [imports] = parse(entry);
    const coreImports = [
      ...new Set(
        imports
          .filter((entryImport) => entryImport.d === -1)
          .map((entryImport) => entryImport.n)
          .filter((specifier): specifier is string => !!specifier?.startsWith("@farm.js/core")),
      ),
    ];
    expect(coreImports.length).toBeGreaterThan(0);

    const reactImports: string[] = [];
    for (const specifier of coreImports) {
      for (const [bare, importer] of await staticBareImports(await resolveCoreEntry(specifier))) {
        if (/^react(-dom)?(\/|$)/.test(bare))
          reactImports.push(`${specifier} -> ${importer} -> ${bare}`);
      }
    }
    expect(reactImports).toEqual([]);
  }, 60_000);
});
