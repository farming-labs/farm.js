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

// The plugin records its runtime, router and render hooks for the paths under test, and serves
// the record from its own endpoints, which run outside the request hooks, so a dev server and a
// production server can be asked the same questions. `/__fail-render` makes the next
// render.before throw. runtime.before replaces the Request for `/swap` with one for `/hello`, and
// records the runtime kind (and an asset's route pattern) it sees.
const FILES: Record<string, string> = {
  "farm.config.ts": `import { definePlugin } from "@farm.js/core";
const state = ((globalThis as any).__farmRenderHookTest ??= { trace: [], failRender: false });
const traced = (pathname: string) => !pathname.startsWith("/__") && !pathname.startsWith("/@");
export default {
  images: { provider: "none" },
  telemetry: false,
  md: { expose: ["/hello"] },
  agent: { crawlers: true, llmsTxt: true, sitemap: true },
  redirects: () => [
    { source: "/old", destination: "/hello" },
    { source: "/api/old", destination: "/api/ok" },
  ],
  rewrites: () => [{ source: "/alias", destination: "/hello" }],
  headers: () => [{ source: "/moved", headers: [{ key: "x-moved", value: "1" }] }],
  plugins: [
    definePlugin({
      name: "acme:render-trace",
      onError({ phase, error }) {
        state.trace.push("onError " + phase + " " + (error as Error).message);
      },
      runtime: {
        endpoints: [
          { path: "/__trace", handler: () => Response.json(state.trace.splice(0)) },
          {
            path: "/__fail-render",
            handler: () => {
              state.failRender = true;
              return new Response(null, { status: 204 });
            },
          },
        ],
        before({ request, kind, route }) {
          const { pathname } = new URL(request.url);
          const detail = kind === "asset" ? kind + " " + route?.pattern : kind;
          if (traced(pathname)) state.trace.push("before " + pathname + " " + detail);
          if (pathname === "/swap") return new Request(new URL("/hello", request.url), request);
        },
        after({ request, response }) {
          const { pathname } = new URL(request.url);
          if (traced(pathname)) state.trace.push("after " + pathname + " " + response.status);
        },
        error({ request, error }) {
          state.trace.push("error " + new URL(request.url).pathname + " " + (error as Error).message);
        },
      },
      router: {
        before({ pathname }) {
          if (traced(pathname)) state.trace.push("router.before " + pathname);
        },
      },
      render: {
        before({ pathname, routePattern }) {
          if (!traced(pathname)) return;
          state.trace.push("render.before " + pathname + " " + routePattern);
          if (state.failRender) {
            state.failRender = false;
            throw new Error("render.before failed");
          }
        },
      },
    }),
  ],
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/page.tsx": `export default function Page() { return <h1>home</h1>; }`,
  "src/app/hello/page.tsx": `export default function Page() { return <h1>hello</h1>; }`,
  "src/app/swap/page.tsx": `export default function Page() { return <h1>swap</h1>; }`,
  "src/app/api/ok/route.ts": `export function GET() { return Response.json({ ok: true }); }`,
  "src/app/blog/sitemap.ts": `export default function sitemap() { return [{ url: "https://farm.test/blog" }]; }`,
  "src/app/manifest.ts": `export default function manifest() { return { name: "Farm test" }; }`,
  "src/routes.ts": `import { defineRoutes } from "@farm.js/core";
export default defineRoutes(({ redirect }) => [
  redirect("/moved", "/hello"),
  redirect("/api/moved", "/api/ok"),
]);`,
};

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
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  for (const [relativePath, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

/** Requests `pathname`, then reads what the plugin recorded for it. */
async function request(origin: string, pathname: string) {
  const response = await fetch(`${origin}${pathname}`, {
    redirect: "manual",
    headers: { accept: "text/html" },
  });
  const result = {
    status: response.status,
    contentType: response.headers.get("content-type"),
    trace: [] as string[],
  };
  await response.body?.cancel();
  result.trace = await (await fetch(`${origin}/__trace`)).json();
  return result;
}

// render.before (and the router hooks) run for every request the production runtime classes as
// a page, on the URL as requested and before Farm resolves it: a config or route-file redirect, a
// config rewrite's source, a generated agent file, a Markdown mirror, the app manifest and the
// not-found page included. A redirect under the API base path and an app metadata route (here
// blog/sitemap.ts and manifest.ts, which the runtime classes as assets) are not pages.
// runtime.before and runtime.after run for every one of them.
async function expectRenderHookContract(origin: string): Promise<void> {
  const page = (pathname: string, routePattern: string | null, status: number) => ({
    status,
    trace: [
      `before ${pathname} page`,
      `router.before ${pathname}`,
      `render.before ${pathname} ${routePattern}`,
      `after ${pathname} ${status}`,
    ],
  });
  const results: Record<string, { status: number; trace: string[] }> = {};
  for (const pathname of [
    "/hello",
    "/old",
    "/api/old",
    "/moved",
    "/api/moved",
    "/alias",
    "/robots.txt",
    "/sitemap.xml",
    "/blog/sitemap.xml",
    "/manifest.webmanifest",
    "/llms.txt",
    "/.well-known/farmjs.json",
    "/missing",
  ]) {
    const { status, trace } = await request(origin, pathname);
    results[pathname] = { status, trace };
  }
  expect(results).toEqual({
    "/hello": page("/hello", "/hello", 200),
    "/old": page("/old", null, 307),
    "/api/old": { status: 307, trace: ["before /api/old api", "after /api/old 307"] },
    "/moved": page("/moved", null, 307),
    "/api/moved": { status: 307, trace: ["before /api/moved api", "after /api/moved 307"] },
    // The hooks see the requested URL, before runtime.before runs again on the destination.
    "/alias": {
      status: 200,
      trace: [
        "before /alias page",
        "router.before /alias",
        "render.before /alias null",
        "before /hello page",
        "after /alias 200",
      ],
    },
    "/robots.txt": page("/robots.txt", null, 200),
    "/sitemap.xml": page("/sitemap.xml", null, 200),
    "/blog/sitemap.xml": {
      status: 200,
      trace: ["before /blog/sitemap.xml asset /blog", "after /blog/sitemap.xml 200"],
    },
    "/manifest.webmanifest": {
      status: 200,
      trace: ["before /manifest.webmanifest asset /", "after /manifest.webmanifest 200"],
    },
    "/llms.txt": page("/llms.txt", null, 200),
    "/.well-known/farmjs.json": page("/.well-known/farmjs.json", null, 200),
    "/missing": page("/missing", null, 404),
  });

  // A Request runtime.before replaces is routed on the replacement, so /swap renders /hello, but
  // the router and render hooks describe the URL as requested, as production takes their route
  // from the incoming request. runtime.after sees the replacement.
  const swapped = await fetch(`${origin}/swap`, { headers: { accept: "text/html" } });
  const swappedHtml = await swapped.text();
  expect({
    status: swapped.status,
    hello: swappedHtml.includes("<h1>hello</h1>"),
    swap: swappedHtml.includes("<h1>swap</h1>"),
    trace: await (await fetch(`${origin}/__trace`)).json(),
  }).toEqual({
    status: 200,
    hello: true,
    swap: false,
    trace: [
      "before /swap page",
      "router.before /swap",
      "render.before /swap /swap",
      "after /hello 200",
    ],
  });

  // A route-file redirect is answered as production answers it: before routes, with the
  // headers() config, and as text.
  const moved = await fetch(`${origin}/moved`, { redirect: "manual" });
  expect({
    status: moved.status,
    location: moved.headers.get("location"),
    header: moved.headers.get("x-moved"),
    body: await moved.text(),
  }).toEqual({ status: 307, location: "/hello", header: "1", body: "Redirecting to /hello" });
  await fetch(`${origin}/__trace`);

  // A Markdown mirror is a page request of its own, and renders its page through another. Farm
  // dev renders that page before the mirror's own request starts, so only the events compare.
  const mirror = await request(origin, "/hello.md");
  expect({ status: mirror.status, trace: mirror.trace.sort() }).toEqual({
    status: 200,
    trace: [...page("/hello.md", null, 200).trace, ...page("/hello", "/hello", 200).trace].sort(),
  });

  // A render.before that throws fails a redirect, a rewrite and a built-in route as it fails a
  // page: runtime.error and onError observe it once, no runtime.after runs, and the request
  // answers the plain-text runtime hook 500.
  const failures: Record<string, unknown> = {};
  for (const pathname of ["/old", "/moved", "/alias", "/.well-known/farmjs.json", "/hello"]) {
    await fetch(`${origin}/__fail-render`);
    failures[pathname] = await request(origin, pathname);
  }
  const failure = (pathname: string, routePattern: string | null) => ({
    status: 500,
    contentType: "text/plain; charset=utf-8",
    trace: [
      `before ${pathname} page`,
      `router.before ${pathname}`,
      `render.before ${pathname} ${routePattern}`,
      `error ${pathname} render.before failed`,
      "onError runtime render.before failed",
    ],
  });
  expect(failures).toEqual({
    "/old": failure("/old", null),
    "/moved": failure("/moved", null),
    "/alias": failure("/alias", null),
    "/.well-known/farmjs.json": failure("/.well-known/farmjs.json", null),
    "/hello": failure("/hello", "/hello"),
  });
}

async function startDevelopment(root: string): Promise<string> {
  const server = await createServer({ root });
  devServers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

async function withProduction(root: string, check: (origin: string) => Promise<void>) {
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

    await check(origin);
  } finally {
    if (productionServer.exitCode === null) productionServer.kill();
    await exited;
  }
}

describe("plugin render hooks for redirects, rewrites, and built-in routes", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-plugin-render-hooks-");
    await expectRenderHookContract(await startDevelopment(root));
  }, 120_000);

  it("in a node-server production build", async () => {
    const root = await createApp("farm-prod-plugin-render-hooks-");
    await withProduction(root, expectRenderHookContract);
  }, 240_000);
});
