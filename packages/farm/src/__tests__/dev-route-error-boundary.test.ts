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
 * A page that throws under an `error.*` file answers with that file's page and the error's
 * status. Development also wrapped the route in the renderer's server `ErrorBoundary`, which
 * production and the browser never render: a renderer whose server boundary catches answered
 * with its fallback and a 200 in development, and a thrown notFound() never reached Farm.
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

// A small string renderer whose server ErrorBoundary renders its fallback for a throw inside it,
// as a renderer's own boundary component naturally does.
const runtime = `export const name = "catching";
export const Fragment = Symbol.for("catching.fragment");
export function Suspense(props) { return props.children; }
export function ErrorBoundary(props) { return props.children; }
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
  if (type === ErrorBoundary) {
    try {
      return render(props.children);
    } catch (error) {
      return render(createElement(props.Fallback, { ...props.fallbackProps, error }));
    }
  }
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
  "src/app/layout.js":
    'export default function Layout(props) {\n  return { type: "main", props: { id: "layout", children: props.children } };\n}\n',
  "src/app/error.js":
    'export default function RouteError() {\n  return { type: "p", props: { id: "route-error", children: "route error page" } };\n}\n',
  "src/app/fail/page.js":
    'export default function Fail() {\n  throw new Error("page failed");\n}\n',
  "src/app/gone/page.js":
    'import { notFound } from "@farm.js/core";\n\nexport default function Gone() {\n  notFound();\n}\n',
  "node_modules/catching-renderer/package.json": JSON.stringify({
    name: "catching-renderer",
    type: "module",
    exports: { "./server": "./server.js", "./client": "./client.js", "./vite": "./vite.js" },
  }),
  "node_modules/catching-renderer/server.js": runtime,
  "node_modules/catching-renderer/client.js": `${runtime}export function createRoot() { return { render() {}, unmount() {} }; }
export function hydrateRoot() { return createRoot(); }
`,
  "node_modules/catching-renderer/vite.js":
    "export function createFarmRendererPlugin() { return []; }\n",
};

const renderer = {
  name: "catching",
  vite: "catching-renderer/vite",
  server: "catching-renderer/server",
  client: "catching-renderer/client",
};

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-dev-route-error-boundary-"));
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

async function expectRouteErrorPages(origin: string): Promise<void> {
  const failed = await fetch(`${origin}/fail`);
  const failedHtml = await failed.text();
  expect(failed.status).toBe(500);
  expect(failedHtml).toContain('<p id="route-error">route error page</p>');

  const gone = await fetch(`${origin}/gone`);
  expect(gone.status).toBe(404);
  expect(await gone.text()).not.toContain("route error page");
}

describe("a route's error file under a renderer whose server boundary catches", () => {
  it("answers a throw with the error page and status in development", async () => {
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
    await expectRouteErrorPages(`http://localhost:${address.port}`);
  }, 60_000);

  it("answers a throw with the error page and status in production", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    try {
      await expectRouteErrorPages(server.origin);
    } finally {
      await server.stop();
    }
  }, 180_000);
});
