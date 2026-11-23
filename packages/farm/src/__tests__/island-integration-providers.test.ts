// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer } from "./production-server";

/**
 * A page that hydrates without its layouts hydrates in its island, and a route slot that hydrates
 * in its container, and the browser renders each root inside the integration providers. The
 * server rendered the providers only around the layouts, so a provider that renders markup (a Vue
 * `<slot />` renders fragment markers) put the root's server HTML out of step with the tree the
 * browser hydrates. Other renderers than React now render the providers inside those roots too;
 * React lines an island up with its own tree position instead.
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

const runtime = `export const name = "plain";
export const Fragment = Symbol.for("plain.fragment");
export function Suspense(props) { return props.children; }
export function createElement(type, props, ...children) {
  if (children.length === 0) return { type, props: { ...props } };
  return { type, props: { ...props, children: children.length > 1 ? children : children[0] } };
}
export function isValidElement(value) {
  return typeof value === "object" && value !== null && "type" in value;
}
const escape = (value) => String(value).replace(/[&<>"]/g, (c) => "&#" + c.charCodeAt(0) + ";");
function render(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(render).join("");
  if (typeof node !== "object") return escape(node);
  const { type, props = {} } = node;
  if (type === Fragment) return render(props.children);
  if (typeof type === "function") return render(type(props));
  let attributes = "";
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "dangerouslySetInnerHTML" || value == null) continue;
    if (typeof value === "function" || typeof value === "object") continue;
    attributes += " " + key + '="' + escape(value) + '"';
  }
  const inner = props.dangerouslySetInnerHTML?.__html ?? render(props.children);
  return "<" + type + attributes + ">" + inner + "</" + type + ">";
}
export function renderToString(element) { return render(element); }
`;

const files: Record<string, string> = {
  "package.json": '{"type":"module","private":true}',
  "farm.config.ts": `import { defineIntegration } from "@farm.js/core";

export default {
  renderer: {
    name: "plain",
    vite: "plain-renderer/vite",
    server: "plain-renderer/server",
    client: "plain-renderer/client",
    capabilities: { functionComponents: true },
  },
  images: { provider: "none" },
  telemetry: false,
  integrations: {
    acme: defineIntegration({
      category: "custom",
      type: "acme",
      instance: {},
      providers: [
        {
          name: "acme",
          type: "client",
          component: { module: "./src/providers/acme.js", export: "AcmeProvider" },
        },
      ],
    }),
  },
};
`,
  "src/providers/acme.js":
    'export function AcmeProvider(props) {\n  return { type: "section", props: { "data-provider": "acme", children: props.children } };\n}\n',
  "src/app/layout.js":
    'export default function Layout(props) {\n  return { type: "main", props: { id: "layout", children: [props.children, props.panel] } };\n}\n',
  "src/app/@panel/page.js":
    'export const hydrate = true;\n\nexport default function Panel() {\n  return { type: "aside", props: { id: "panel", children: "panel" } };\n}\n',
  "src/app/page.js":
    'export const hydrate = true;\n\nexport default function Page() {\n  return { type: "p", props: { id: "page", children: "page" } };\n}\n',
  "node_modules/plain-renderer/package.json": JSON.stringify({
    name: "plain-renderer",
    type: "module",
    exports: { "./server": "./server.js", "./client": "./client.js", "./vite": "./vite.js" },
  }),
  "node_modules/plain-renderer/server.js": runtime,
  "node_modules/plain-renderer/client.js": `${runtime}export function createRoot() { return { render() {}, unmount() {} }; }
export function hydrateRoot() { return createRoot(); }
`,
  "node_modules/plain-renderer/vite.js":
    "export function createFarmRendererPlugin() { return []; }\n",
};

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-island-providers-"));
  roots.push(root);
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(
    await fs.realpath(packageRoot),
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
  return root;
}

async function expectProviderInsideIsland(origin: string): Promise<void> {
  const response = await fetch(`${origin}/`);
  const html = await response.text();
  expect(response.status).toBe(200);
  // The browser hydrates the island with the provider around the page.
  expect(html).toMatch(
    /<div id="__farm_page__"[^>]*><section data-provider="acme"><p id="page">page<\/p><\/section><\/div>/,
  );
  // A route slot that hydrates is a root of its own too.
  expect(html).toMatch(
    /<div id="[^"]*" data-farm-route-slot="panel"[^>]*><section data-provider="acme"><aside id="panel">panel<\/aside><\/section><\/div>/,
  );
  // The layouts keep the provider around them, so server-rendered layouts read it too.
  expect(html).toMatch(/<section data-provider="acme">[^]*<main id="layout">/);
}

describe("integration providers around a page island or route slot that hydrates", () => {
  it("render inside the root in development", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "development")), root },
      "development",
    );
    const server = await createServer(config as never);
    servers.push(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    await expectProviderInsideIsland(`http://localhost:${address.port}`);
  }, 60_000);

  it("render inside the root in production", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    try {
      await expectProviderInsideIsland(server.origin);
    } finally {
      await server.stop();
    }
  }, 180_000);
});
