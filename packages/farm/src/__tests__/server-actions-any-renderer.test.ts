// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { REACT_RENDERER } from "../renderer";
import { farmBrowserServerFnsEnabled, resolveFarmIslxActionsMode } from "../server-actions-mode";
import { createServer } from "../server/create-server";

/**
 * Browser code could import a server function only through @farm.js/plugin/rsc or islands mode,
 * both React-only, so an app on any other renderer stopped with CLIENT_SERVER_FUNCTION. With
 * `experimental.serverActions`, such an app now runs them on islx's actions as islands mode does:
 * the browser gets references that post to the page, compiled against islx's React-free runtime.
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

describe("resolveFarmIslxActionsMode", () => {
  it("runs islands mode's actions in islands mode, with or without the flag", () => {
    const islands = { serverComponents: { mode: "islands" } };
    expect(resolveFarmIslxActionsMode({ experimental: islands })).toBe("islands");
    // Server functions imported by browser code still need the flag there.
    expect(farmBrowserServerFnsEnabled({ experimental: islands })).toBe(false);
    expect(farmBrowserServerFnsEnabled({ experimental: { ...islands, serverActions: true } })).toBe(
      true,
    );
  });

  it("runs the React-free actions for any other renderer with the flag", () => {
    const config = { renderer, experimental: { serverActions: true } };
    expect(resolveFarmIslxActionsMode(config)).toBe("renderer");
    expect(farmBrowserServerFnsEnabled(config)).toBe(true);
  });

  it("leaves React outside islands mode, an app without a renderer, and the flag off alone", () => {
    for (const config of [
      { experimental: { serverActions: true } },
      { renderer: REACT_RENDERER, experimental: { serverActions: true } },
      { renderer: false as const, experimental: { serverActions: true } },
      { renderer },
      { renderer, experimental: { serverActions: false } },
    ]) {
      expect(resolveFarmIslxActionsMode(config)).toBeNull();
      expect(farmBrowserServerFnsEnabled(config)).toBe(false);
    }
  });
});

const runtime = `export const Fragment = Symbol.for("plain.fragment");
export function Suspense(props) { return props.children; }
export function createElement(type, props, ...children) {
  return { type, props: { ...props, children } };
}
export function isValidElement(value) { return typeof value === "object" && value !== null; }
`;

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-server-actions-any-renderer-"));
  roots.push(root);
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "src/app/page.js": "export default function Page() {\n  return null;\n}\n",
    "src/server/greet.ts": `import { createServerFn } from "@farm.js/core/server-fn";
export const greet = createServerFn({
  async handler({ input }: { input: { name: string } }) {
    return \`Hello, \${input.name}, from the server.\`;
  },
});
`,
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
  // The compiled modules import Farm's islx runtime by package name.
  await fs.mkdir(path.join(root, "node_modules/@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules/@farm.js/core"), "junction");
  return root;
}

async function startServer(serverActions: boolean): Promise<ViteDevServer> {
  const server = await createServer({
    root: await createApp(),
    renderer,
    images: { provider: "none" },
    experimental: { serverActions },
  });
  servers.push(server);
  return server;
}

describe("a server function imported by browser code in an app on another renderer", () => {
  it("reaches the browser as a reference to the action", async () => {
    const server = await startServer(true);
    const client = server.environments.client;

    const module = await client.transformRequest("/src/server/greet.ts");
    expect(module?.code).toContain('export { greet } from "/src/server/greet.ts?farm-server-fns"');
    const boundary = await client.transformRequest("/src/server/greet.ts?farm-server-fns");
    expect(boundary?.code).toContain("islx-actions-client");
    expect(boundary?.code).toMatch(/export const greet = \$\$islx_ref\(/);
    expect(boundary?.code).not.toContain("from the server.");

    // The server registers it under the id the reference names.
    const ssr = await server.environments.ssr.transformRequest(
      "/src/server/greet.ts?farm-server-fns",
    );
    expect(ssr?.code).toContain("islx-actions-server");
    const id = /\$\$islx_ref\("([^"]+)"/.exec(boundary!.code)![1]!;
    expect(ssr?.code).toMatch(new RegExp(`registerServerReference\\)?\\(greet, "${id}",`));
  }, 60_000);

  // No app file imports the runtime the reference imports, so Vite's scan cannot see it. Found on
  // the first request instead, it made Vite bundle again and reload the page while it loaded.
  it("pre-bundles the runtime the reference imports before the first request", async () => {
    const server = await startServer(true);
    const optimizer = server.environments.client.depsOptimizer;
    if (!optimizer) throw new Error("The client environment has no dependency optimizer.");
    await optimizer.init();
    await optimizer.scanProcessing;
    expect(Object.keys(optimizer.metadata.discovered)).toContain(
      "@farm.js/core/internal/islx-actions-client",
    );
  }, 60_000);

  it("still fails with CLIENT_SERVER_FUNCTION without experimental.serverActions", async () => {
    const server = await startServer(false);
    await expect(
      server.environments.client.transformRequest("/src/server/greet.ts"),
    ).rejects.toThrow("CLIENT_SERVER_FUNCTION");
  }, 60_000);
});
