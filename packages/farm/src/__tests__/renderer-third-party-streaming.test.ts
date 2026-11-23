// @vitest-environment node

import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
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
 * The official renderers prove Farm's streaming paths, but each of them wraps a mature framework.
 * This renderer is only the contract: it renders the markup before a `Gate` element, then waits
 * for the test to open an HTTP gate before rendering the rest. A response that streams delivers
 * the markup before the gate while the renderer is still waiting. A buffered one delivers nothing
 * until the gate opens, and the test times out.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  // Newest first, so servers stop before the directories they serve are removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// What the renderer's client needs in the document before it hydrates, as Solid's `_$HY` globals.
const HYDRATION_SCRIPT = "<script>window.__TRICKLE_HYDRATION__=true</script>";

const rendererFiles: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "trickle-renderer",
    type: "module",
    exports: {
      ".": "./index.js",
      "./server-node": "./server-node.js",
      "./server-web": "./server-web.js",
      "./client": "./client.js",
      "./vite": "./vite.js",
    },
  }),
  "index.js": `export const HYDRATION_SCRIPT = ${JSON.stringify(HYDRATION_SCRIPT)};
export const Fragment = Symbol.for("trickle.fragment");
export const Gate = Symbol.for("trickle.gate");
export function Suspense(props) { return props.children; }
export function createElement(type, props, ...children) {
  const { key: _key, ref: _ref, ...rest } = props || {};
  if (children.length > 0) rest.children = children.length === 1 ? children[0] : children;
  return { $$trickle: true, type, props: rest };
}
export function isValidElement(value) {
  return typeof value === "object" && value !== null && value.$$trickle === true;
}
const escape = (value) => String(value).replace(/[&<>"]/g, (c) => "&#" + c.charCodeAt(0) + ";");
const FLUSH = Symbol("flush");
async function* walk(node) {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
    return;
  }
  if (!isValidElement(node)) {
    yield escape(node);
    return;
  }
  const { type, props } = node;
  if (type === Gate) {
    yield FLUSH;
    const reply = await fetch(globalThis.process.env.TRICKLE_GATE_URL + (props.fail ? "fail" : ""));
    if ((await reply.text()) === "fail") throw new Error("trickle failed after the gate");
    yield* walk(props.children);
    return;
  }
  if (type === Fragment) {
    yield* walk(props.children);
    return;
  }
  if (typeof type === "function") {
    yield* walk(await type(props));
    return;
  }
  let attributes = "";
  for (const [name, value] of Object.entries(props)) {
    if (name === "children" || name === "dangerouslySetInnerHTML") continue;
    if (value == null || value === false || typeof value === "function" || typeof value === "object") continue;
    attributes += " " + (name === "className" ? "class" : name) + (value === true ? "" : '="' + escape(value) + '"');
  }
  yield "<" + type + attributes + ">";
  if (props.dangerouslySetInnerHTML) yield props.dangerouslySetInnerHTML.__html;
  else yield* walk(props.children);
  yield "</" + type + ">";
}
/** The markup in chunks: one for everything before each gate, and one for the rest. */
export async function* renderChunks(node) {
  let html = "";
  for await (const piece of walk(node)) {
    if (piece !== FLUSH) html += piece;
    else if (html) {
      yield html;
      html = "";
    }
  }
  if (html) yield html;
}
export async function renderToString(node) {
  let html = "";
  for await (const chunk of renderChunks(node)) html += chunk;
  return html;
}
`,
  "server-node.js": `import { HYDRATION_SCRIPT, renderChunks } from "./index.js";
export { Fragment, Suspense, createElement, isValidElement, renderToString } from "./index.js";
export const name = "trickle";
export function generateHydrationScript() { return HYDRATION_SCRIPT; }
export function renderToPipeableStream(element, callbacks) {
  const chunks = renderChunks(element);
  const shell = chunks.next();
  shell.then(() => callbacks.onShellReady(), (error) => callbacks.onShellError(error));
  return {
    pipe(destination) {
      (async () => {
        try {
          for (let result = await shell; !result.done; result = await chunks.next()) {
            destination.write(result.value);
          }
        } catch (error) {
          callbacks.onError(error);
        }
        destination.end();
      })();
    },
  };
}
`,
  "server-web.js": `import { HYDRATION_SCRIPT, renderChunks } from "./index.js";
export { Fragment, Suspense, createElement, isValidElement, renderToString } from "./index.js";
export const name = "trickle";
export function generateHydrationScript() { return HYDRATION_SCRIPT; }
const encoder = new TextEncoder();
export function renderToReadableStream(element, options) {
  const chunks = renderChunks(element);
  let started = false;
  return new ReadableStream({
    async pull(controller) {
      let result;
      try {
        result = await chunks.next();
      } catch (error) {
        // Before any output the error decides the response. After it, report it and close.
        if (!started) return controller.error(error);
        options?.onError?.(error);
        return controller.close();
      }
      if (result.done) return controller.close();
      started = true;
      controller.enqueue(encoder.encode(result.value));
    },
    cancel() {
      return chunks.return();
    },
  });
}
`,
  "client.js": `export { Fragment, Suspense, createElement, isValidElement } from "./index.js";
export function createRoot(container) {
  return { render() {}, unmount() { container.replaceChildren(); } };
}
export function hydrateRoot(container) {
  return createRoot(container);
}
`,
  "vite.js": "export function createFarmRendererPlugin() { return []; }\n",
};

const primitives = [
  { primitive: "renderToPipeableStream", server: "server-node", streaming: { node: true } },
  { primitive: "renderToReadableStream", server: "server-web", streaming: { web: true } },
] as const;

type Primitive = (typeof primitives)[number];

function rendererFor({ server, streaming }: Primitive) {
  return {
    name: "trickle",
    vite: "trickle-renderer/vite",
    server: `trickle-renderer/${server}`,
    client: "trickle-renderer/client",
    capabilities: { functionComponents: true, streaming },
  };
}

async function createApp(variant: Primitive): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-renderer-streaming-"));
  cleanups.push(() =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const coreLink = path.join(root, "node_modules", "@farm.js", "core");
  await fs.mkdir(path.dirname(coreLink), { recursive: true });
  await fs.symlink(await fs.realpath(packageRoot), coreLink, "junction");
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default ${JSON.stringify({
      renderer: rendererFor(variant),
      images: { provider: "none" },
      telemetry: false,
    })};\n`,
    "src/app/layout.js": `import { createElement as h } from "trickle-renderer";
export default function Layout(props) {
  return h("main", { id: "trickle-layout" }, props.children);
}
`,
    "src/app/page.js": `import { Gate, createElement as h } from "trickle-renderer";
export default function Page() {
  return h("section", null, h("p", null, "before the gate"), h(Gate, null, h("p", null, "after the gate")));
}
`,
    "src/app/broken/page.js": `export default function Broken() {
  throw new Error("trickle failed before any output");
}
`,
    "src/app/late/page.js": `import { Gate, createElement as h } from "trickle-renderer";
export default function Late() {
  return h("section", null, h("p", null, "before the failure"), h(Gate, { fail: true }, h("p", null, "never rendered")));
}
`,
    ...Object.fromEntries(
      Object.entries(rendererFiles).map(([file, source]) => [
        `node_modules/trickle-renderer/${file}`,
        source,
      ]),
    ),
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

/**
 * An HTTP endpoint that holds every request until `open()`, and `reached` settles on the first.
 * `/fail` answers at once with the reply that makes the renderer throw.
 */
async function startGate() {
  const held: http.ServerResponse[] = [];
  let opened = false;
  let markReached!: () => void;
  const reached = new Promise<void>((resolve) => (markReached = resolve));
  const server = http.createServer((request, response) => {
    if (request.url === "/fail") {
      response.end("fail");
      return;
    }
    markReached();
    if (opened) response.end("open");
    else held.push(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    reached,
    open() {
      opened = true;
      for (const response of held.splice(0)) response.end("open");
    },
  };
}

/**
 * Reads the page while the renderer waits at the gate, then opens it and reads the rest.
 * Returns what had arrived before the gate opened, and the whole document.
 */
async function readThroughGate(url: string, gate: Awaited<ReturnType<typeof startGate>>) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (!html.includes("before the gate")) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  // The renderer is blocked on the gate, so nothing after it can have been rendered yet.
  await gate.reached;
  const beforeGate = html;
  gate.open();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return { beforeGate, html: html + decoder.decode() };
}

function expectStreamedThroughGate(beforeGate: string, html: string) {
  expect(beforeGate).toMatch(/^<!DOCTYPE html>/i);
  expect(beforeGate.slice(0, beforeGate.indexOf("</head>"))).toContain(HYDRATION_SCRIPT);
  expect(beforeGate).toContain('<main id="trickle-layout">');
  expect(beforeGate).toContain("<p>before the gate</p>");
  expect(beforeGate).not.toContain("after the gate");
  expect(html).toContain("<p>before the gate</p><p>after the gate</p></section>");
  expect(html).toMatch(/<\/html>\s*$/);
}

/**
 * A render that fails before any output answers with an error status. One that fails after
 * output has gone out can't change the status, so the response ends with what was sent.
 */
async function expectRenderErrorsEndTheResponse(origin: string) {
  const broken = await fetch(`${origin}/broken`);
  expect(broken.status).toBe(500);
  await broken.text();

  const late = await fetch(`${origin}/late`);
  expect(late.status).toBe(200);
  const html = await late.text();
  expect(html).toContain("<p>before the failure</p>");
  expect(html).not.toContain("never rendered");
}

describe.each(primitives)("a third-party renderer that streams with $primitive", (variant) => {
  it("streams the page in a production build", async () => {
    const root = await createApp(variant);
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const gate = await startGate();
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"), {
      env: { TRICKLE_GATE_URL: gate.url },
    });
    cleanups.push(() => server.stop());

    const { beforeGate, html } = await readThroughGate(`${server.origin}/`, gate);
    expectStreamedThroughGate(beforeGate, html);
    await expectRenderErrorsEndTheResponse(server.origin);
  }, 240_000);

  it("streams the page in development", async () => {
    const root = await createApp(variant);
    const gate = await startGate();
    const previousGateUrl = process.env.TRICKLE_GATE_URL;
    process.env.TRICKLE_GATE_URL = gate.url;
    cleanups.push(async () => {
      if (previousGateUrl === undefined) delete process.env.TRICKLE_GATE_URL;
      else process.env.TRICKLE_GATE_URL = previousGateUrl;
    });
    const server: ViteDevServer = await createServer({
      root,
      renderer: rendererFor(variant),
      images: { provider: "none" },
    });
    cleanups.push(() => server.close());
    const port = await getAvailablePort();
    await server.listen(port);

    const { beforeGate, html } = await readThroughGate(`http://127.0.0.1:${port}/`, gate);
    expectStreamedThroughGate(beforeGate, html);
    await expectRenderErrorsEndTheResponse(`http://127.0.0.1:${port}`);
  }, 60_000);
});
