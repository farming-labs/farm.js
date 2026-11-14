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

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

/**
 * An app with an `OPTIONS` route export, a route without one, a `routeRules` CORS prefix, a page,
 * and app middleware that marks every response it runs for.
 */
async function createOptionsFixture(prefix: string, farmConfig = ""): Promise<string> {
  // Inside the package so the production build resolves React and @farm.js/core from the workspace.
  const root = await fs.mkdtemp(path.join(packageRoot, prefix));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default {
  images: { provider: "none" },
  routeRules: {
    "/api/cors/**": { cors: true },
    "/api/cors/closed/**": { cors: false },
  },
  ${farmConfig}
};`,
  );
  await writeModule(
    root,
    "src/app/middleware.ts",
    `export function middleware(_request: Request, context: { headers: Headers }) {
  context.headers.set("x-app-middleware", "yes");
}`,
  );
  await writeModule(
    root,
    "src/app/api/opt/route.ts",
    `export function GET() {
  return Response.json({ ok: true });
}
export function OPTIONS() {
  return new Response("options", { status: 200, headers: { "x-custom-options": "yes" } });
}`,
  );
  await writeModule(
    root,
    "src/app/api/echo/route.ts",
    `export function GET() {
  return Response.json({ echo: true });
}
export async function POST(request: Request) {
  return Response.json({ echo: await request.text() });
}`,
  );
  await writeModule(
    root,
    "src/app/api/cors/thing/route.ts",
    `export function POST() {
  return Response.json({ cors: true });
}`,
  );
  await writeModule(
    root,
    "src/app/api/cors/closed/route.ts",
    `export function POST() {
  return Response.json({ cors: false });
}`,
  );
  await writeModule(
    root,
    "src/app/layout.tsx",
    `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
  );
  await writeModule(
    root,
    "src/app/page.tsx",
    `import React from "react";
export default function Page() { return <main>home</main>; }`,
  );
  await writeModule(
    root,
    "src/app/about/page.tsx",
    `import React from "react";
export default function About() { return <main>about</main>; }`,
  );
  return root;
}

/** What production answers, which `farm dev` must match. */
async function expectOptionsResponses(origin: string): Promise<void> {
  // A route's own OPTIONS export answers, with app middleware applied.
  const custom = await fetch(`${origin}/api/opt`, { method: "OPTIONS" });
  expect(custom.status).toBe(200);
  expect(custom.headers.get("x-custom-options")).toBe("yes");
  expect(custom.headers.get("x-app-middleware")).toBe("yes");
  expect(custom.headers.get("access-control-allow-methods")).toBeNull();
  await expect(custom.text()).resolves.toBe("options");

  // A route without one answers 405 and lists the methods it has.
  const unsupported = await fetch(`${origin}/api/echo`, { method: "OPTIONS" });
  expect(unsupported.status).toBe(405);
  expect(unsupported.headers.get("allow")).toBe("GET, HEAD, POST");
  expect(unsupported.headers.get("access-control-allow-methods")).toBeNull();
  await unsupported.body?.cancel();

  // A browser preflight under a routeRules `cors` prefix is allowed.
  const preflight = await fetch(`${origin}/api/cors/thing`, {
    method: "OPTIONS",
    headers: {
      origin: "https://ex.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  await preflight.body?.cancel();

  // A more specific `cors: false` turns the rule off, so the route answers the preflight.
  const closed = await fetch(`${origin}/api/cors/closed`, {
    method: "OPTIONS",
    headers: { origin: "https://ex.com", "access-control-request-method": "POST" },
  });
  expect(closed.status).toBe(405);
  expect(closed.headers.get("allow")).toBe("POST");
  await closed.body?.cancel();

  // A page renders for OPTIONS as for any other method.
  const page = await fetch(`${origin}/about/`, { method: "OPTIONS" });
  expect(page.status).toBe(200);
  expect(page.headers.get("access-control-allow-methods")).toBeNull();
  await page.body?.cancel();

  // App responses carry no CORS headers the app did not ask for.
  const cross = await fetch(`${origin}/api/echo`, { headers: { origin: "http://localhost:1" } });
  expect(cross.status).toBe(200);
  expect(cross.headers.get("access-control-allow-origin")).toBeNull();
  expect(cross.headers.get("vary") ?? "").not.toMatch(/\borigin\b/i);
  await cross.body?.cancel();
}

async function startDevServer(root: string): Promise<{ origin: string; server: ViteDevServer }> {
  const server = await createServer({ root });
  devServers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return { origin: `http://localhost:${address.port}`, server };
}

describe("OPTIONS requests", () => {
  it("reach routes, middleware, and routeRules CORS in development", async () => {
    const root = await createOptionsFixture(".tmp-options-dev-");
    const { origin } = await startDevServer(root);

    await expectOptionsResponses(origin);

    // Vite's own modules keep Vite's default CORS for another local origin, such as a federation
    // host on a different port, and still refuse other origins.
    const client = await fetch(`${origin}/@vite/client`, {
      headers: { origin: "http://localhost:4100" },
    });
    expect(client.status).toBe(200);
    expect(client.headers.get("access-control-allow-origin")).toBe("http://localhost:4100");
    expect(client.headers.get("vary")).toMatch(/\borigin\b/i);
    await client.body?.cancel();

    const appModule = await fetch(`${origin}/src/app/page.tsx`, {
      headers: { origin: "http://127.0.0.1:4100" },
    });
    expect(appModule.status).toBe(200);
    expect(appModule.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4100");
    await appModule.body?.cancel();

    const modulePreflight = await fetch(`${origin}/@vite/client`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:4100", "access-control-request-method": "GET" },
    });
    expect(modulePreflight.status).toBe(204);
    expect(modulePreflight.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:4100",
    );

    const foreign = await fetch(`${origin}/@vite/client`, {
      headers: { origin: "https://ex.com" },
    });
    expect(foreign.status).toBe(200);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    await foreign.body?.cancel();
  }, 60_000);

  it("leaves an app's own vite.server.cors to Vite", async () => {
    const root = await createOptionsFixture(
      ".tmp-options-dev-cors-",
      `vite: { server: { cors: { origin: "https://ex.com" } } },`,
    );
    const { origin } = await startDevServer(root);

    const response = await fetch(`${origin}/api/echo`, { headers: { origin: "https://ex.com" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://ex.com");
    await response.body?.cancel();
  }, 60_000);

  it("answers the same in production", async () => {
    const root = await createOptionsFixture(".tmp-options-prod-");
    const userConfig = await loadConfig(root, undefined, "production");
    const config = await resolveConfig({ ...userConfig, root }, "production");
    await build(config, { root, preset: "node-server" });

    const productionServer = await startProductionServer(
      path.join(root, ".farm", ".output", "server"),
    );
    try {
      await expectOptionsResponses(productionServer.origin);
    } finally {
      await productionServer.stop();
    }
  }, 180_000);
});
