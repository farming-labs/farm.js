// @vitest-environment node

import { spawn } from "node:child_process";
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

// Middleware that reports the path it saw, guards /admin, and blocks any path ending in /blocked.
const MIDDLEWARE = `export function middleware(request: Request, context: { headers: Headers }) {
  const { pathname } = new URL(request.url);
  context.headers.set("x-mw-path", pathname);
  if (/\\/admin(\\/|$)/.test(pathname) && !request.headers.get("authorization")) {
    return new Response("unauthorized", { status: 401, headers: { "x-mw-path": pathname } });
  }
  if (pathname.endsWith("/blocked")) {
    return new Response("blocked", { status: 403, headers: { "x-mw-path": pathname } });
  }
}`;

const ECHO_ROUTE = `export function GET(request: Request) {
  const url = new URL(request.url);
  return Response.json({ path: url.pathname, q: url.searchParams.get("q") });
}`;

type Fixture = Record<string, string>;

const PAGES_APP: Fixture = {
  "farm.config.ts": `export default {
  images: { provider: "none" },
  telemetry: false,
  redirects: () => [{ source: "/old/:path*", destination: "/new/:path*" }],
  rewrites: () => [
    { source: "/dash", destination: "/admin" },
    { source: "/rw/:path*", destination: "/api/echo" },
    { source: "/rw-api", destination: "/api/echo" },
  ],
  headers: () => [{ source: "/:path*", headers: [{ key: "x-config", value: "on" }] }],
};`,
  "src/app/middleware.ts": MIDDLEWARE,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/page.tsx": `export default function Page() { return <h1>home page</h1>; }`,
  "src/app/admin/page.tsx": `export default function Page() { return <h1>admin page</h1>; }`,
  "src/app/api/echo/route.ts": ECHO_ROUTE,
};

const BASE_PATH_APP: Fixture = {
  "farm.config.ts": `export default {
  basePath: "/console",
  images: { provider: "none" },
  telemetry: false,
  redirects: () => [{ source: "/old-about", destination: "/about" }],
  rewrites: () => [{ source: "/rw-about", destination: "/about" }],
  headers: () => [{ source: "/about", headers: [{ key: "x-about", value: "on" }] }],
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/page.tsx": `export default function Page() { return <h1>home page</h1>; }`,
  "src/app/about/page.tsx": `export default function Page() { return <h1>about page</h1>; }`,
};

const BACKEND_APP: Fixture = {
  "farm.config.ts": `export default {
  renderer: false,
  telemetry: false,
  rewrites: () => [{ source: "/rw/:path*", destination: "/api/echo" }],
};`,
  "src/app/middleware.ts": MIDDLEWARE,
  "src/app/api/echo/route.ts": ECHO_ROUTE,
};

async function createApp(prefix: string, files: Fixture): Promise<string> {
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
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

type Run = (origin: string) => Promise<void>;

async function runInDevelopment(prefix: string, files: Fixture, run: Run): Promise<void> {
  const root = await createApp(`${prefix}dev-`, files);
  const server = await createServer({ root });
  devServers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  await run(`http://localhost:${address.port}`);
}

async function runInProduction(prefix: string, files: Fixture, run: Run): Promise<void> {
  const root = await createApp(`${prefix}prod-`, files);
  const config = await resolveConfig(
    { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
    "production",
  );
  await build(config, { root, preset: "node-server" });

  const output = path.join(root, ".farm", ".output");
  const port = await getAvailablePort();
  const processOutput: string[] = [];
  const productionServer = spawn(process.execPath, [path.join(output, "server", "index.mjs")], {
    cwd: path.join(output, "server"),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  productionServer.stdout.on("data", (chunk) => processOutput.push(String(chunk)));
  productionServer.stderr.on("data", (chunk) => processOutput.push(String(chunk)));
  const exited = new Promise<void>((resolve) => productionServer.once("exit", () => resolve()));

  try {
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 200 && !ready; attempt++) {
      if (productionServer.exitCode !== null) break;
      ready = await fetch(`${origin}/_farm/health/ready`).then(
        (response) => response.ok,
        () => false,
      );
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready, processOutput.join("")).toBe(true);
    await run(origin);
  } finally {
    if (productionServer.exitCode === null) productionServer.kill();
    await exited;
  }
}

async function get(origin: string, pathname: string, init?: RequestInit) {
  const response = await fetch(`${origin}${pathname}`, { redirect: "manual", ...init });
  return { response, body: await response.text() };
}

// Redirects, then rewrites (re-entering routing for the destination), then middleware, then the
// route. headers() apply to whatever answers, matched on the requested path.
const expectPagesApp: Run = async (origin) => {
  // A rewrite into a guarded section runs the destination's middleware.
  const guarded = await get(origin, "/dash");
  expect(guarded.response.status, "/dash").toBe(401);
  expect(guarded.response.headers.get("x-mw-path")).toBe("/admin");
  expect(guarded.response.headers.get("x-config")).toBe("on");

  const allowed = await get(origin, "/dash", { headers: { authorization: "Bearer ok" } });
  expect(allowed.response.status, "/dash with auth").toBe(200);
  expect(allowed.body).toContain("admin page");

  // Middleware sees the destination, not the requested path it would have blocked.
  const rewrittenApi = await get(origin, "/rw/blocked?q=1");
  expect(rewrittenApi.response.status, "/rw/blocked").toBe(200);
  expect(JSON.parse(rewrittenApi.body)).toEqual({ path: "/api/echo", q: "1" });
  expect(rewrittenApi.response.headers.get("x-mw-path")).toBe("/api/echo");

  // A page path rewritten to an API route is served by that route.
  const pageToApi = await get(origin, "/rw-api?q=2");
  expect(pageToApi.response.status, "/rw-api").toBe(200);
  expect(JSON.parse(pageToApi.body)).toEqual({ path: "/api/echo", q: "2" });

  // Redirects answer before middleware, with configured headers and a body.
  const redirected = await get(origin, "/old/blocked?q=3");
  expect(redirected.response.status, "/old/blocked").toBe(307);
  expect(redirected.response.headers.get("location")).toBe("/new/blocked?q=3");
  expect(redirected.response.headers.get("x-config")).toBe("on");
  expect(redirected.response.headers.get("x-mw-path")).toBeNull();
  expect(redirected.body).toBe("Redirecting to /new/blocked?q=3");

  // A middleware short-circuit still carries configured headers.
  const blocked = await get(origin, "/elsewhere/blocked");
  expect(blocked.response.status, "/elsewhere/blocked").toBe(403);
  expect(blocked.response.headers.get("x-config")).toBe("on");

  const home = await get(origin, "/");
  expect(home.response.status).toBe(200);
  expect(home.body).toContain("home page");
  expect(home.response.headers.get("x-config")).toBe("on");
};

// Sources and headers match the app-relative path; internal destinations stay inside the app.
const expectBasePathApp: Run = async (origin) => {
  const redirected = await get(origin, "/console/old-about?q=1");
  expect(redirected.response.status, "/console/old-about").toBe(307);
  expect(redirected.response.headers.get("location")).toBe("/console/about?q=1");

  const rewritten = await get(origin, "/console/rw-about");
  expect(rewritten.response.status, "/console/rw-about").toBe(200);
  expect(rewritten.body).toContain("about page");

  const about = await get(origin, "/console/about");
  expect(about.response.status).toBe(200);
  expect(about.response.headers.get("x-about")).toBe("on");
};

const expectBackendApp: Run = async (origin) => {
  const rewritten = await get(origin, "/rw/foo?q=1");
  expect(rewritten.response.status, "/rw/foo").toBe(200);
  expect(JSON.parse(rewritten.body)).toEqual({ path: "/api/echo", q: "1" });

  const blockedSource = await get(origin, "/rw/blocked");
  expect(blockedSource.response.status, "/rw/blocked").toBe(200);
  expect(blockedSource.response.headers.get("x-mw-path")).toBe("/api/echo");
};

const cases: Array<[name: string, prefix: string, files: Fixture, run: Run]> = [
  [
    "redirects, rewrites, middleware, and headers",
    "farm-config-routes-",
    PAGES_APP,
    expectPagesApp,
  ],
  ["config routes under a basePath", "farm-config-routes-base-", BASE_PATH_APP, expectBasePathApp],
  [
    "rewrites in an app without a renderer",
    "farm-config-routes-api-",
    BACKEND_APP,
    expectBackendApp,
  ],
];

describe.each(cases)("%s", (_name, prefix, files, run) => {
  it("in development", async () => {
    await runInDevelopment(prefix, files, run);
  }, 120_000);

  it("in a node-server production build", async () => {
    await runInProduction(prefix, files, run);
  }, 240_000);
});
