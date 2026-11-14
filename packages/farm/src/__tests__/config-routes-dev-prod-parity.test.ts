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

const ECHO_ANY_METHOD_ROUTE = `export function GET(request: Request) {
  return Response.json({ method: request.method, path: new URL(request.url).pathname });
}
export const POST = GET;
export const DELETE = GET;`;

// Encoded captures, and requests for a public file that production's static handler does not
// answer (it serves only GET and HEAD), so config routes see them.
const EDGE_APP: Fixture = {
  "farm.config.ts": `export default {
  images: { provider: "none" },
  telemetry: false,
  redirects: () => [
    { source: "/cfg/:slug", destination: "/:slug" },
    { source: "/cfg-all/:path*", destination: "/:path*" },
    { source: "/moved.txt", destination: "/new-place" },
    { source: "/src/:path*", destination: "/gone" },
    { source: "/package.json", destination: "/", permanent: false },
  ],
  rewrites: () => [
    { source: "/rewritten.txt", destination: "/api/echo" },
    { source: "/lib/rewritten-source.ts", destination: "/api/echo" },
    { source: "/rw-enc/:slug", destination: "/api/files/:slug" },
  ],
  headers: () => [
    { source: "/:path*", headers: [{ key: "x-config", value: "on" }] },
    { source: "/enc/:slug", headers: [{ key: "x-enc", value: "on" }] },
  ],
};`,
  "public/moved.txt": "moved file",
  "public/rewritten.txt": "rewritten file",
  "lib/rewritten-source.ts": "export const rewrittenSource = true;",
  "lib/data.json": '{"unrouted":true}',
  "src/app/styles.css": "h1 { color: red; }",
  "src/app/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/page.tsx": `export default function Page() { return <h1>home page</h1>; }`,
  "src/app/api/echo/route.ts": ECHO_ANY_METHOD_ROUTE,
  "src/app/api/files/[slug]/route.ts": `export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return Response.json({ slug, path: new URL(request.url).pathname });
}`,
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

  const productionServer = await startProductionServer(
    path.join(root, ".farm", ".output", "server"),
  );
  try {
    await run(productionServer.origin);
  } finally {
    await productionServer.stop();
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

const expectEdgeApp: Run = async (origin) => {
  // An encoded slash is part of the segment it arrived in, and the destination keeps it encoded,
  // so the Location stays a path on this origin rather than a protocol-relative URL.
  for (const [pathname, location] of [
    ["/cfg/%2F%2Fexample.com", "/%2F%2Fexample.com"],
    ["/cfg/%2Fexample.com", "/%2Fexample.com"],
    ["/cfg/a%2Fb", "/a%2Fb"],
    ["/cfg/plain", "/plain"],
    ["/cfg/caf%C3%A9", "/caf%C3%A9"],
    ["/cfg-all/%2F%2Fexample.com/x", "/%2F%2Fexample.com/x"],
    ["/cfg-all/a/b", "/a/b"],
  ]) {
    const redirected = await get(origin, `${pathname}?q=1`);
    expect(redirected.response.status, pathname).toBe(307);
    expect(redirected.response.headers.get("location"), pathname).toBe(`${location}?q=1`);
    expect(redirected.response.headers.get("x-config"), pathname).toBe("on");
  }

  // A literal second slash is a collapsed separator, never a capture.
  const collapsed = await get(origin, "/cfg//example.com");
  expect(collapsed.response.status, "/cfg//example.com").toBe(307);
  expect(collapsed.response.headers.get("location")).toBe("/example.com");

  // A rewrite passes the capture on encoded; the route decodes it once into its param.
  const rewritten = await get(origin, "/rw-enc/%2F%2Fexample.com");
  expect(rewritten.response.status, "/rw-enc/%2F%2Fexample.com").toBe(200);
  expect(JSON.parse(rewritten.body)).toEqual({
    slug: "//example.com",
    path: "/api/files/%2F%2Fexample.com",
  });

  // A header source matches the encoded segment as one segment.
  const encodedHeader = await get(origin, "/enc/%2F%2Fexample.com");
  expect(encodedHeader.response.headers.get("x-enc"), "/enc/%2F%2Fexample.com").toBe("on");
  const nestedHeader = await get(origin, "/enc/a/b");
  expect(nestedHeader.response.headers.get("x-enc"), "/enc/a/b").toBeNull();

  // GET and HEAD of a public file are the file, before any config route.
  for (const method of ["GET", "HEAD"]) {
    const file = await get(origin, "/moved.txt", { method });
    expect(file.response.status, `${method} /moved.txt`).toBe(200);
    expect(file.body).toBe(method === "GET" ? "moved file" : "");
    const rewrittenFile = await get(origin, "/rewritten.txt", { method });
    expect(rewrittenFile.response.status, `${method} /rewritten.txt`).toBe(200);
    expect(rewrittenFile.body).toBe(method === "GET" ? "rewritten file" : "");
  }

  // Any other method is not the static handler's, so config redirects, rewrites, and headers
  // apply to it.
  for (const method of ["POST", "DELETE"]) {
    const redirected = await get(origin, "/moved.txt?q=1", { method });
    expect(redirected.response.status, `${method} /moved.txt`).toBe(307);
    expect(redirected.response.headers.get("location")).toBe("/new-place?q=1");
    expect(redirected.response.headers.get("x-config")).toBe("on");

    const rewritten = await get(origin, "/rewritten.txt", { method });
    expect(rewritten.response.status, `${method} /rewritten.txt`).toBe(200);
    expect(JSON.parse(rewritten.body)).toEqual({ method, path: "/api/echo" });
    expect(rewritten.response.headers.get("x-config")).toBe("on");
  }

  // The same holds for a source file, which production does not serve at all.
  const sourceFile = await get(origin, "/src/app/page.tsx", { method: "POST" });
  expect(sourceFile.response.status, "POST /src/app/page.tsx").toBe(307);
  expect(sourceFile.response.headers.get("location")).toBe("/gone");

  // A GET or HEAD for a file under the project root production never emits is a path like any
  // other there: config redirects and rewrites, and headers(), apply to it.
  for (const method of ["GET", "HEAD"]) {
    const redirected = await get(origin, "/src/app/page.tsx?q=1", { method });
    expect(redirected.response.status, `${method} /src/app/page.tsx`).toBe(307);
    expect(redirected.response.headers.get("location")).toBe("/gone?q=1");
    expect(redirected.response.headers.get("x-config")).toBe("on");

    const rootFile = await get(origin, "/package.json", { method });
    expect(rootFile.response.status, `${method} /package.json`).toBe(307);
    expect(rootFile.response.headers.get("location")).toBe("/");
  }
  const rewrittenSource = await get(origin, "/lib/rewritten-source.ts");
  expect(rewrittenSource.response.status, "GET /lib/rewritten-source.ts").toBe(200);
  expect(JSON.parse(rewrittenSource.body)).toEqual({ method: "GET", path: "/api/echo" });
  expect(rewrittenSource.response.headers.get("x-config")).toBe("on");
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
  [
    "encoded captures and non-GET requests for public files",
    "farm-config-routes-edge-",
    EDGE_APP,
    expectEdgeApp,
  ],
];

// Vite's own requests stay Vite's whatever config route matches their path: its endpoints, and
// the running app's module, stylesheet, asset, and fetch() requests for a source file.
it("leaves Vite module and client requests to Vite in development", async () => {
  await runInDevelopment("farm-config-routes-vite-", EDGE_APP, async (origin) => {
    for (const [pathname, headers, contentType] of [
      ["/@vite/client", {}, "javascript"],
      ["/src/app/page.tsx?import", {}, "javascript"],
      ["/src/app/page.tsx", { "sec-fetch-dest": "script" }, "javascript"],
      ["/src/app/page.tsx?t=1700000000000", {}, "javascript"],
      ["/src/app/page.tsx?raw", {}, "javascript"],
      ["/src/app/page.tsx?url", {}, "javascript"],
      ["/src/app/page.tsx?worker", {}, "javascript"],
      // A module request from a page on an insecure origin carries no fetch metadata.
      ["/src/app/page.tsx", { referer: `${origin}/`, accept: "*/*" }, "javascript"],
      ["/src/app/styles.css", { "sec-fetch-dest": "script" }, "javascript"],
      ["/src/app/styles.css", { "sec-fetch-dest": "style", accept: "text/css" }, "text/css"],
      ["/src/app/styles.css?direct", { accept: "text/css" }, "text/css"],
      ["/src/app/logo.svg", { "sec-fetch-dest": "image" }, "image/svg+xml"],
      ["/package.json", { "sec-fetch-dest": "empty" }, "json"],
      ["/lib/rewritten-source.ts", { "sec-fetch-dest": "script" }, "javascript"],
    ] as const) {
      const response = await get(origin, pathname, { headers });
      const label = `${pathname} ${JSON.stringify(headers)}`;
      expect(response.response.status, label).toBe(200);
      expect(response.response.headers.get("content-type"), label).toContain(contentType);
    }

    // A navigation to a source file is the browser asking for a page, with or without metadata.
    for (const headers of [
      { "sec-fetch-dest": "document" },
      { referer: `${origin}/`, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    ]) {
      const redirected = await get(origin, "/src/app/page.tsx", { headers });
      expect(redirected.response.status, JSON.stringify(headers)).toBe(307);
      expect(redirected.response.headers.get("location")).toBe("/gone");
    }

    // A source file no config route matches is still Vite's file.
    const unrouted = await get(origin, "/lib/data.json");
    expect(unrouted.response.status).toBe(200);
    expect(JSON.parse(unrouted.body)).toEqual({ unrouted: true });
  });
}, 120_000);

describe.each(cases)("%s", (_name, prefix, files, run) => {
  it("in development", async () => {
    await runInDevelopment(prefix, files, run);
  }, 120_000);

  it("in a node-server production build", async () => {
    await runInProduction(prefix, files, run);
  }, 240_000);
});
