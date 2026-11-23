// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { defineIntegration } from "../integrations";
import { createServer } from "../server/create-server";

/**
 * An integration provider wraps every page, on the server and in the browser. The development
 * browser entry gave it only to React apps, while development server rendering and both
 * production entries gave it to every renderer: another renderer's page rendered inside the
 * provider on the server and hydrated without it, in development only.
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

const runtime = `export const name = "plain";
export const Fragment = Symbol.for("plain.fragment");
export function Suspense(props) { return props.children; }
export function createElement(type, props, ...children) {
  return { type, props: { ...props, children } };
}
export function isValidElement(value) { return typeof value === "object" && value !== null; }
`;

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-dev-client-providers-"));
  roots.push(root);
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "src/app/page.js": "export default function Page() {\n  return null;\n}\n",
    "src/providers/acme.js": "export function AcmeProvider(props) {\n  return props.children;\n}\n",
    "node_modules/plain-renderer/package.json": JSON.stringify({
      name: "plain-renderer",
      type: "module",
      exports: { "./server": "./server.js", "./client": "./client.js", "./vite": "./vite.js" },
    }),
    "node_modules/plain-renderer/server.js": `${runtime}export function renderToString() { return ""; }\n`,
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
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(
    await fs.realpath(packageRoot),
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
  return root;
}

describe("integration providers in the development browser entry", () => {
  it("wrap pages for every renderer, as on the server and in production", async () => {
    const root = await createApp();
    const server = await createServer({
      root,
      renderer,
      images: { provider: "none" },
      integrations: {
        acme: defineIntegration({
          category: "custom",
          type: "acme",
          instance: {},
          providers: [
            {
              name: "acme",
              type: "client",
              props: { label: "dev-provider" },
              component: { module: "./src/providers/acme.js", export: "AcmeProvider" },
            },
          ],
        }),
      },
    } as never);
    servers.push(server);

    const entry = (await server.transformRequest("/@farm/client"))?.code ?? "";
    expect(entry).toMatch(
      /import \* as FarmIntegrationProviderModule0 from "[^"]*providers\/acme\.js"/,
    );
    expect(entry).toContain('name: "acme"');
    expect(entry).toContain('props: {"label":"dev-provider"}');
  }, 60_000);
});
