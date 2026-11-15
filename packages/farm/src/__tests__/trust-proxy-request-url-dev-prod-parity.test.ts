// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
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
 * With `server.trustProxy`, middleware, pages, and API routes read the URL the visitor requested,
 * at the origin the proxy forwards, in development and production alike. Production used to hand
 * each of them the adapter's internal URL while development forwarded it to middleware and pages.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const devServers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...devServers].map((server) => server.close()));
  devServers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

const files = (trustProxy: boolean): Record<string, string> => ({
  "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false, server: { trustProxy: ${trustProxy} } };`,
  "src/app/layout.tsx":
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  "src/app/middleware.ts": `export function middleware(request: Request, ctx: { url: URL; headers: Headers }) {
  ctx.headers.set("x-middleware-url", request.url + " " + ctx.url.href);
  if (new URL(request.url).pathname === "/sign-in-required") {
    return Response.redirect(new URL("/sign-in", request.url), 307);
  }
}`,
  "src/app/page.tsx": `import { getCurrentRequest } from "@farm.js/core";
export const dynamic = "force-dynamic";
export default function Home() { return <main data-url={getCurrentRequest().url}>home</main>; }`,
  "src/app/api/echo/route.ts": `export async function POST(request: Request) {
  return Response.json({ url: request.url, body: await request.text() });
}`,
});

async function createApp(prefix: string, trustProxy: boolean): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
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
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  for (const [relativePath, source] of Object.entries(files(trustProxy))) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

type Run = (origin: string) => Promise<void>;

async function runInDevelopment(trustProxy: boolean, run: Run): Promise<void> {
  const server = await createServer({ root: await createApp("farm-proxy-url-dev-", trustProxy) });
  devServers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  await run(`http://localhost:${address.port}`);
}

async function runInProduction(trustProxy: boolean, run: Run): Promise<void> {
  const root = await createApp("farm-proxy-url-prod-", trustProxy);
  const config = await resolveConfig(
    { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
    "production",
  );
  await build(config, { root, preset: "node-server" });
  const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
  try {
    await run(server.origin);
  } finally {
    await server.stop();
  }
}

const forwarded = { "x-forwarded-host": "app.example.com", "x-forwarded-proto": "https" };

async function observe(origin: string) {
  const page = await fetch(`${origin}/?tab=1`, { headers: forwarded });
  const html = await page.text();
  const api = await fetch(`${origin}/api/echo?q=1`, {
    method: "POST",
    headers: { ...forwarded, "content-type": "text/plain" },
    body: "posted body",
  });
  const redirect = await fetch(`${origin}/sign-in-required`, {
    headers: forwarded,
    redirect: "manual",
  });
  return {
    middleware: page.headers.get("x-middleware-url"),
    page: html.match(/data-url="([^"]*)"/)?.[1],
    api: await api.json(),
    redirect: redirect.headers.get("location"),
  };
}

describe.each([
  ["development", runInDevelopment],
  ["production", runInProduction],
] as const)("the request URL in %s", (_mode, run) => {
  it("is the forwarded public URL under trustProxy", async () => {
    await run(true, async (origin) => {
      expect(await observe(origin)).toEqual({
        middleware: "https://app.example.com/?tab=1 https://app.example.com/?tab=1",
        page: "https://app.example.com/?tab=1",
        api: { url: "https://app.example.com/api/echo?q=1", body: "posted body" },
        redirect: "https://app.example.com/sign-in",
      });
    });
  }, 180_000);

  it("ignores forwarded headers without trustProxy", async () => {
    await run(false, async (origin) => {
      const observed = await observe(origin);
      expect(JSON.stringify(observed)).not.toContain("app.example.com");
      expect(observed.api.body).toBe("posted body");
    });
  }, 180_000);
});
