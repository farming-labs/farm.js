// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

// The guard the desktop example uses: every request needs the session cookie.
const FILES: Record<string, string> = {
  "farm.config.ts": `import { definePlugin } from "@farm.js/core";
export default {
  images: { provider: "none" },
  telemetry: false,
  agent: { llmsTxt: { full: true }, apiCatalog: true, crawlers: true },
  openapi: { enabled: true, route: "/api-reference", specRoute: "/openapi.json" },
  plugins: [
    definePlugin({
      name: "acme:session-guard",
      runtime: {
        before({ request }) {
          if (!(request.headers.get("cookie") ?? "").includes("session=ok")) {
            return new Response("guarded", { status: 403 });
          }
        },
      },
    }),
  ],
};`,
  "src/app/layout.tsx": `export const metadata = { title: "Acme" };
export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/page.tsx": `export const metadata = { title: "Home", description: "Acme builds tools." };
export default function Page() { return <><h1>Home</h1><p>Welcome home.</p></>; }`,
  "src/app/about/page.tsx": `export const metadata = { title: "About us" };
export default function Page() { return <><h1>About us</h1><p>We ship tools.</p></>; }`,
  "src/app/api/hello/route.ts": `export function GET() { return Response.json({ hello: true }); }`,
};

type Probe = { name: string; path: string; init?: RequestInit };

const MCP_INIT: RequestInit = {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
};

const PROBES: Probe[] = [
  { name: "page", path: "/about" },
  { name: "api route", path: "/api/hello" },
  { name: "app manifest", path: "/.well-known/farmjs.json" },
  { name: "legacy app manifest", path: "/.well-known/farmjs" },
  { name: "ai catalog", path: "/.well-known/ai-catalog.json" },
  { name: "ard", path: "/.well-known/ard.json" },
  { name: "mcp server card", path: "/mcp/server-card" },
  { name: "default mcp", path: "/mcp", init: MCP_INIT },
  { name: "api catalog", path: "/.well-known/api-catalog" },
  { name: "llms.txt", path: "/llms.txt" },
  { name: "llms-full.txt", path: "/llms-full.txt" },
  { name: "sitemap.xml", path: "/sitemap.xml" },
  { name: "robots.txt", path: "/robots.txt" },
  { name: "markdown mirror", path: "/about.md" },
  { name: "markdown negotiation", path: "/about", init: { headers: { accept: "text/markdown" } } },
  { name: "openapi spec", path: "/openapi.json" },
  { name: "openapi reference", path: "/api-reference" },
];

async function createApp(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(
    path.join(root, "package.json"),
    '{"name":"acme-site","version":"3.1.0","type":"module","private":true}',
  );
  for (const [relativePath, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

function withCookie(init: RequestInit | undefined, cookie: string | undefined): RequestInit {
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("cookie", cookie);
  return { ...init, headers };
}

async function expectGuarded(fetchPath: (path: string, init: RequestInit) => Promise<Response>) {
  const unguarded: string[] = [];
  const unserved: string[] = [];
  for (const probe of PROBES) {
    const blocked = await fetchPath(probe.path, withCookie(probe.init, undefined));
    const body = await blocked.text();
    if (blocked.status !== 403 || body !== "guarded") {
      unguarded.push(`${probe.name} ${probe.path}: ${blocked.status}`);
    }
    // With the cookie each endpoint answers as it does without the plugin.
    const allowed = await fetchPath(probe.path, withCookie(probe.init, "session=ok"));
    await allowed.arrayBuffer();
    if (allowed.status !== 200) unserved.push(`${probe.name} ${probe.path}: ${allowed.status}`);
  }
  expect(unguarded).toEqual([]);
  expect(unserved).toEqual([]);
}

describe("a runtime.before guard covers Farm's built-in endpoints", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-plugin-guard-");
    const server = await createServer({ root });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    await expectGuarded((pathname, init) => fetch(`${origin}${pathname}`, init));
  }, 120_000);

  it("in production", async () => {
    const root = await createApp("farm-prod-plugin-guard-");
    const resolved = await resolveConfig(
      {
        ...(await loadConfig(root, undefined, "production")),
        root,
        srcDir: "src",
        deploy: { target: "vercel" },
      },
      "production",
    );
    await build(resolved, { root, preset: "vercel" });
    const functionPath = path.resolve(
      root,
      resolved.deploy.outputDir,
      "functions",
      "__nitro.func",
      "index.mjs",
    );
    const handler = (await import(/* @vite-ignore */ pathToFileURL(functionPath).href)).default;

    await expectGuarded((pathname, init) =>
      handler.fetch(new Request(`https://acme.test${pathname}`, init)),
    );
  }, 240_000);
});
