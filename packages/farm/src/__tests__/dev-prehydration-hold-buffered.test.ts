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
 * Until a page hydrates, a script in its head holds clicks and submits, which the page replays
 * once it has. Development wrote that script only into the documents it streams. A renderer that
 * renders to a string, as Svelte and many custom renderers do, takes the buffered path, so a
 * submit made before its page hydrated posted the form natively in development, while the
 * production build held and replayed it.
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

// A string renderer: it has renderToString() and no stream, so every page is buffered.
const runtime = `export const name = "string";
export const Fragment = Symbol.for("string.fragment");
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
    if (key === "children" || value == null) continue;
    if (typeof value === "function" || typeof value === "object") continue;
    attributes += " " + key + '="' + escape(value) + '"';
  }
  return "<" + type + attributes + ">" + render(props.children) + "</" + type + ">";
}
export function renderToString(element) { return render(element); }
`;

const form =
  '{ type: "form", props: { children: { type: "button", props: { type: "submit", children: "Save" } } } }';

const files: Record<string, string> = {
  "package.json": '{"type":"module","private":true}',
  "src/app/hold/page.js": `"use client";\n\nexport default function Hold() {\n  return ${form};\n}\n`,
  "src/app/static/page.js": `export default function Static() {\n  return ${form};\n}\n`,
  "node_modules/string-renderer/package.json": JSON.stringify({
    name: "string-renderer",
    type: "module",
    exports: { "./server": "./server.js", "./client": "./client.js", "./vite": "./vite.js" },
  }),
  "node_modules/string-renderer/server.js": runtime,
  "node_modules/string-renderer/client.js": `${runtime}export function createRoot() { return { render() {}, unmount() {} }; }
export function hydrateRoot() { return createRoot(); }
`,
  "node_modules/string-renderer/vite.js":
    "export function createFarmRendererPlugin() { return []; }\n",
};

const renderer = {
  name: "string",
  vite: "string-renderer/vite",
  server: "string-renderer/server",
  client: "string-renderer/client",
};

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-dev-prehydration-hold-"));
  roots.push(root);
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default ${JSON.stringify({ renderer, images: { provider: "none" }, telemetry: false })};\n`,
  );
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(
    await fs.realpath(packageRoot),
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
  return root;
}

async function readHead(origin: string, pathname: string): Promise<string> {
  const html = await (await fetch(`${origin}${pathname}`)).text();
  expect(html).toContain("<button");
  return html.slice(0, html.indexOf("</head>"));
}

// A page that hydrates holds its interactions from the head; one nothing hydrates over has
// nothing to replay them, so it holds none.
async function expectHoldOnHydratingPagesOnly(origin: string): Promise<void> {
  expect(await readHead(origin, "/hold")).toContain("__FARM_PREHYDRATION_CLICK_QUEUE__");
  expect(await readHead(origin, "/static")).not.toContain("__FARM_PREHYDRATION_CLICK_QUEUE__");
}

describe("the pre-hydration hold under a renderer that renders to a string", () => {
  it("is written into a hydrating page's head in development", async () => {
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
    await expectHoldOnHydratingPagesOnly(`http://localhost:${address.port}`);
  }, 60_000);

  it("is written into a hydrating page's head in production", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    try {
      await expectHoldOnHydratingPagesOnly(server.origin);
    } finally {
      await server.stop();
    }
  }, 120_000);
});
