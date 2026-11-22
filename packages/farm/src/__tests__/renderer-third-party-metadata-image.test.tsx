// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createFarmMetadataImageResponse } from "../metadata-image";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer } from "./production-server";

/**
 * A generated metadata image renders with the app's renderer. Like Vue's, Solid's, and Svelte's,
 * this renderer keeps an element's children outside `props`, which Satori can't read, and it
 * compiles its own component files (`.plain`), whose default export is a component rather than a
 * function Farm can call: the shape of an `opengraph-image.vue` or `opengraph-image.svelte`.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  // Newest first, so servers stop before the directories they serve are removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const rendererFiles: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "plain-renderer",
    type: "module",
    exports: {
      ".": "./index.js",
      "./server": "./server.js",
      "./client": "./client.js",
      "./vite": "./vite.js",
    },
  }),
  "index.js": `export const Fragment = Symbol.for("plain.fragment");
export function Suspense(props) { return props.children; }
export function createElement(type, props, ...children) {
  const { key: _key, ref: _ref, ...rest } = props || {};
  return { $$plain: true, type, props: rest, children };
}
export function isValidElement(value) {
  return typeof value === "object" && value !== null && value.$$plain === true;
}
const escape = (value) => String(value).replace(/[&<>"]/g, (c) => "&#" + c.charCodeAt(0) + ";");
const hyphenate = (name) => name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
const styleText = (style) =>
  Object.entries(style).map(([name, value]) => hyphenate(name) + ":" + (typeof value === "number" ? value + "px" : value)).join(";");
function render(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(render).join("");
  if (typeof node === "string" || typeof node === "number") return escape(node);
  if (!isValidElement(node)) throw new Error("plain-renderer can't render " + Object.prototype.toString.call(node));
  const { type, props, children } = node;
  if (type === Fragment) return render(children);
  // A compiled .plain component, as opposed to a plain function component.
  if (type && typeof type === "object" && typeof type.render === "function") {
    return render(type.render(props));
  }
  if (typeof type === "function") {
    const result = type({ ...props, children });
    if (result && typeof result.then === "function") {
      throw new Error("plain-renderer doesn't render async components: " + (type.name || "anonymous"));
    }
    return render(result);
  }
  let attributes = "";
  for (const [name, value] of Object.entries(props)) {
    if (value == null || value === false || typeof value === "function") continue;
    const text = name === "style" ? styleText(value) : value;
    attributes += " " + (name === "className" ? "class" : name) + '="' + escape(text) + '"';
  }
  return "<!--[--><" + type + attributes + ">" + render(children) + "</" + type + "><!--]-->";
}
export function renderToString(node) {
  return render(node);
}
`,
  "server.js": `export { Fragment, Suspense, createElement, isValidElement, renderToString } from "./index.js";
export const name = "plain";
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

const renderer = {
  name: "plain",
  vite: "plain-renderer/vite",
  server: "plain-renderer/server",
  client: "plain-renderer/client",
  componentExtensions: [".plain"],
  capabilities: { functionComponents: true },
};

const size = { width: 300, height: 150 };
const cardStyle = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  background: "#000",
  color: "#fff",
  padding: 12,
};

/** The image each route draws, built with the app renderer's `createElement`. */
function cardSource(label: string): string {
  return `h("div", { style: ${JSON.stringify(cardStyle)} },
    h("span", { style: { fontSize: 32 } }, ${JSON.stringify(label)}, " ", props.path),
    h("span", { className: "text-emerald-400" }, "rows: ", 12),
  )`;
}

function ReactCard({ label, path: routePath }: { label: string; path: string }) {
  return (
    <div style={cardStyle as React.CSSProperties}>
      <span style={{ fontSize: 32 }}>
        {label} {routePath}
      </span>
      <span className="text-emerald-400">rows: {12}</span>
    </div>
  );
}

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-renderer-metadata-image-"));
  cleanups.push(() =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const coreLink = path.join(root, "node_modules", "@farm.js", "core");
  await fs.mkdir(path.dirname(coreLink), { recursive: true });
  await fs.symlink(await fs.realpath(packageRoot), coreLink, "junction");
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default ${JSON.stringify({
      renderer,
      images: { provider: "none" },
      telemetry: false,
    })};\n`,
    "src/app/layout.js": `import { createElement as h } from "plain-renderer";
export default function Layout(props) {
  return h("main", { id: "plain-layout" }, props.children);
}
`,
    "src/app/page.js": `import { createElement as h } from "plain-renderer";
export default function Home() {
  return h("p", null, "home");
}
`,
    // A function Farm calls, awaited before the renderer sees its element.
    "src/app/opengraph-image.js": `import { createElement as h } from "plain-renderer";
export const size = ${JSON.stringify(size)};
export default async function OpenGraphImage(props) {
  await Promise.resolve();
  return ${cardSource("Plain")};
}
`,
    // A component in the renderer's own file type.
    "src/app/twitter-image.plain": `import { createElement as h } from "plain-renderer";
export const size = ${JSON.stringify(size)};
export default {
  render(props) {
    return ${cardSource("Component")};
  },
};
`,
    ...Object.fromEntries(
      Object.entries(rendererFiles).map(([file, source]) => [
        `node_modules/plain-renderer/${file}`,
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

async function reactPng(label: string): Promise<Buffer> {
  const response = await createFarmMetadataImageResponse(<ReactCard label={label} path="/" />, {
    size,
  });
  return Buffer.from(await response.arrayBuffer());
}

async function expectMetadataImages(origin: string) {
  for (const [route, label] of [
    ["/opengraph-image", "Plain"],
    ["/twitter-image", "Component"],
  ] as const) {
    const response = await fetch(origin + route);
    const body = Buffer.from(await response.arrayBuffer());
    expect(response.status, `${route}: ${body.toString("utf8", 0, 200)}`).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    // The same picture the image draws in React.
    expect(body.equals(await reactPng(label)), route).toBe(true);
  }

  const page = await (await fetch(origin + "/")).text();
  expect(page).toContain('<meta property="og:image" content="/opengraph-image');
  expect(page).toContain('<meta name="twitter:image" content="/twitter-image');
}

describe("generated metadata images on a third-party renderer", () => {
  it("render in a production build", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    cleanups.push(() => server.stop());

    await expectMetadataImages(server.origin);
  }, 240_000);

  it("render in development", async () => {
    const root = await createApp();
    const server: ViteDevServer = await createServer({
      root,
      renderer,
      images: { provider: "none" },
    });
    cleanups.push(() => server.close());
    const port = await getAvailablePort();
    await server.listen(port);

    await expectMetadataImages(`http://127.0.0.1:${port}`);
  }, 60_000);
});
