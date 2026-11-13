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

// The plugin records every runtime hook (and onError report) it sees, app middleware records
// that it ran (and guards a built-in route, the app manifest), and the plugin serves the record
// from its own endpoint, which runs outside the request hooks, so a dev server and a production
// server can be asked the same questions.
const TRACED = `const traced = (request: Request) => {
  const { pathname } = new URL(request.url);
  return /^\\/(api|integration|docs)\\//.test(pathname) ||
    pathname === "/docs" ||
    pathname === "/hello" ||
    pathname.startsWith("/hello/") ||
    pathname === "/.well-known/farmjs.json"
    ? pathname
    : null;
};
const trace: string[] = ((globalThis as any).__farmTestTrace ??= []);`;

const FILES: Record<string, string> = {
  "farm.config.ts": `import { defineIntegration, definePlugin } from "@farm.js/core";
${TRACED}
export default {
  images: { provider: "none" },
  telemetry: false,
  redirects: () => [
    { source: "/hello/moved/:rest", destination: "/hello" },
    { source: "/api/moved/:rest", destination: "/api/ok" },
  ],
  rewrites: () => [{ source: "/hello/rewritten", destination: "/hello/before-fails" }],
  integrations: {
    acme: defineIntegration({
      category: "custom",
      type: "acme",
      routes: [
        {
          path: "/integration/boom",
          methods: ["GET"],
          handler(): Response {
            throw new Error("integration failed");
          },
        },
      ],
    }),
  },
  plugins: [
    definePlugin({
      name: "acme:trace",
      onError({ phase, error }) {
        trace.push("onError " + phase + " " + (error as Error).message);
      },
      runtime: {
        endpoints: [{ path: "/__trace", handler: () => Response.json(trace.splice(0)) }],
        before({ request, kind }) {
          const pathname = traced(request);
          if (!pathname) return;
          trace.push("before " + kind + " " + pathname);
          if (pathname === "/api/blocked") return new Response("blocked", { status: 403 });
          if (pathname.endsWith("/before-fails")) throw new Error("before failed");
        },
        after({ request, response }) {
          const pathname = traced(request);
          if (!pathname) return;
          trace.push("after " + pathname + " " + response.status);
          if (pathname.endsWith("/after-fails") || new URL(request.url).search === "?after-fails") {
            throw new Error("after failed");
          }
        },
        error({ request, error }) {
          const pathname = traced(request);
          if (pathname) trace.push("error " + pathname + " " + (error as Error).message);
        },
      },
    }),__HTML_TRANSFORM__
  ],
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/hello/page.tsx": `export default function Page() { return <h1>hello</h1>; }`,
  "src/app/hello/after-fails/page.tsx": `export default function Page() { return <h1>after</h1>; }`,
  "src/app/hello/transform-fails/page.tsx": `export default function Page() { return <h1>transform-fails-marker</h1>; }`,
  "src/app/hello/render-fails/page.tsx": `export default function Page() { return <h1>render</h1>; }`,
  "src/app/hello/router-fails/page.tsx": `export default function Page() { return <h1>router</h1>; }`,
  "src/app/hello/render-before-fails/page.tsx": `export default function Page() { return <h1>render</h1>; }`,
  "src/app/middleware.ts": `${TRACED}
export function middleware(request: Request) {
  const pathname = traced(request);
  // farm dev runs render.before after app middleware, production before it; this checks how
  // its failure is reported, not that order.
  if (!pathname || pathname === "/hello/render-before-fails") return;
  trace.push("middleware " + pathname);
  if (pathname === "/api/mw-fails") throw new Error("middleware failed");
  if (
    pathname === "/api/guarded" ||
    (pathname === "/.well-known/farmjs.json" && !new URL(request.url).search)
  ) {
    return new Response("guarded", { status: 401 });
  }
}`,
  "src/app/api/ok/route.ts": `export function GET() { return Response.json({ ok: true }); }`,
  "src/app/api/after-fails/route.ts": `export function GET() { return Response.json({ ok: true }); }`,
  "src/app/api/mw-fails/route.ts": `export function GET() { return Response.json({ ok: true }); }`,
  "src/app/api/boom/route.ts": `export function GET(): Response { throw new Error("route failed"); }`,
};

// A second plugin with HTML transform hooks, which make farm dev buffer a page response before
// runtime.after sees it. transformHTML fails on one page's markup, afterRender on another path,
// and its router.before and render.before hooks fail on their own paths.
const HTML_TRANSFORM_PLUGIN = `
    definePlugin({
      name: "acme:html",
      router: {
        before({ pathname }: { pathname: string }) {
          if (pathname === "/hello/router-fails") throw new Error("router failed");
        },
      },
      render: {
        before({ pathname }: { pathname: string }) {
          if (pathname === "/hello/render-before-fails") throw new Error("render.before failed");
        },
      },
      transformHTML(html: string) {
        if (html.includes("transform-fails-marker")) throw new Error("transform failed");
        return html;
      },
      afterRender(html: string, { pathname }: { pathname: string }) {
        if (pathname.endsWith("/render-fails")) throw new Error("render failed");
        return html;
      },
    }),`;

// The built-in docs engine, with a client root layout that fails when it wraps one docs page:
// farm dev and production wrap docs HTML in the app's client layouts inside the docs route.
const DOCS_FILES: Record<string, string> = {
  "src/app/layout.tsx": `"use client";
export default function Layout({ children }) {
  if (String(children?.props?.dangerouslySetInnerHTML?.__html ?? "").includes("layout-fails-marker")) {
    throw new Error("layout failed");
  }
  return <main>{children}</main>;
}`,
  "src/app/docs/page.md": "---\ntitle: Docs\n---\n# Docs\n",
  "src/app/docs/layout-fails/page.md":
    "---\ntitle: Layout fails\n---\n# Layout fails\n\nlayout-fails-marker\n",
};

async function createApp(
  prefix: string,
  options: { htmlTransform?: boolean; docs?: boolean; renderer?: false } = {},
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  // A backend-only `renderer: false` app has no pages or layouts and links only `@farm.js/core`,
  // as an app that never installed React.
  const backendOnly = options.renderer === false;
  const config = [
    "telemetry: false,",
    ...(options.docs ? ["docs: { enabled: true },"] : []),
    ...(backendOnly ? ["renderer: false,"] : []),
  ].join("\n  ");
  for (const name of backendOnly ? [] : ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  for (const [relativePath, source] of Object.entries({
    ...FILES,
    ...(options.docs ? DOCS_FILES : {}),
  })) {
    if (backendOnly && /\/(page|layout)\.tsx$/.test(relativePath)) continue;
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(
      path.join(root, relativePath),
      source
        .replace("__HTML_TRANSFORM__", options.htmlTransform ? HTML_TRANSFORM_PLUGIN : "")
        .replace("telemetry: false,", config),
    );
  }
  return root;
}

interface TracedResponse {
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  body: string;
  trace: string[];
}

/** Requests `pathname`, then reads what the plugin recorded for it. */
async function request(origin: string, pathname: string, init?: RequestInit) {
  const response = await fetch(`${origin}${pathname}`, init);
  const result: TracedResponse = {
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    body: await response.text(),
    trace: [],
  };
  result.trace = await (await fetch(`${origin}/__trace`)).json();
  return result;
}

async function expectRuntimeHookContract(
  origin: string,
  { pages = true }: { pages?: boolean } = {},
): Promise<void> {
  const results: Record<string, { status: number; trace: string[] }> = {};
  const thrown: Record<string, Partial<Omit<TracedResponse, "status" | "trace">>> = {};
  const pathnames = [
    "/api/ok",
    "/api/blocked",
    "/api/guarded",
    "/api/missing",
    "/api/boom",
    "/api/before-fails",
    "/api/after-fails",
    "/api/mw-fails",
    "/integration/boom",
    "/.well-known/farmjs.json",
    ...(pages ? ["/hello"] : []),
  ];
  for (const pathname of pathnames) {
    const { status, trace, ...response } = await request(origin, pathname);
    if (/\/(boom|before-fails|after-fails|mw-fails)$/.test(pathname)) thrown[pathname] = response;
    // Only production keeps a response a runtime.before guard let through out of shared
    // caches (see the plugins docs), so a route's own 500 is compared without that header.
    if (pathname.endsWith("/boom")) delete thrown[pathname]?.cacheControl;
    results[pathname] = { status, trace };
  }

  expect(results).toEqual({
    // A matched API route: before, then app middleware, then after on its response.
    "/api/ok": {
      status: 200,
      trace: ["before api /api/ok", "middleware /api/ok", "after /api/ok 200"],
    },
    // An unmatched API path still passes through runtime.before, so a guard answers it before
    // app middleware runs, and runtime.after sees that early answer.
    "/api/blocked": {
      status: 403,
      trace: ["before api /api/blocked", "after /api/blocked 403"],
    },
    // runtime.after sees a response app middleware answers with.
    "/api/guarded": {
      status: 401,
      trace: ["before api /api/guarded", "middleware /api/guarded", "after /api/guarded 401"],
    },
    // Farm's JSON 404 for an unmatched API path is a response like any other.
    "/api/missing": {
      status: 404,
      trace: ["before api /api/missing", "middleware /api/missing", "after /api/missing 404"],
    },
    // A throwing API route: runtime.error observes the throw, onError gets it once as the
    // "runtime" phase, then runtime.after sees the 500 Farm answers with.
    "/api/boom": {
      status: 500,
      trace: [
        "before api /api/boom",
        "middleware /api/boom",
        "error /api/boom route failed",
        "onError runtime route failed",
        "after /api/boom 500",
      ],
    },
    // A runtime.before hook that throws: runtime.error observes it, onError gets it once, and
    // neither app middleware nor runtime.after runs.
    "/api/before-fails": {
      status: 500,
      trace: [
        "before api /api/before-fails",
        "error /api/before-fails before failed",
        "onError runtime before failed",
      ],
    },
    // A runtime.after hook that throws: runtime.error observes it, and onError gets it once.
    "/api/after-fails": {
      status: 500,
      trace: [
        "before api /api/after-fails",
        "middleware /api/after-fails",
        "after /api/after-fails 200",
        "error /api/after-fails after failed",
        "onError runtime after failed",
      ],
    },
    // App middleware that throws on an API path fails the request like a throwing API route:
    // runtime.error observes the throw, onError gets it once, and runtime.after sees the 500.
    "/api/mw-fails": {
      status: 500,
      trace: [
        "before api /api/mw-fails",
        "middleware /api/mw-fails",
        "error /api/mw-fails middleware failed",
        "onError runtime middleware failed",
        "after /api/mw-fails 500",
      ],
    },
    // A throwing integration route follows the same contract (integration routes answer
    // before app middleware).
    "/integration/boom": {
      status: 500,
      trace: [
        "before integration /integration/boom",
        "error /integration/boom integration failed",
        "onError runtime integration failed",
        "after /integration/boom 500",
      ],
    },
    // A built-in route (here the app manifest) app middleware answers: runtime.after sees
    // that response, as for an API route.
    "/.well-known/farmjs.json": {
      status: 401,
      trace: [
        "before page /.well-known/farmjs.json",
        "middleware /.well-known/farmjs.json",
        "after /.well-known/farmjs.json 401",
      ],
    },
    // Page requests are unchanged.
    ...(pages
      ? {
          "/hello": {
            status: 200,
            trace: ["before page /hello", "middleware /hello", "after /hello 200"],
          },
        }
      : {}),
  });
  // A throwing API or integration route, and a throwing runtime hook on an API path, answer
  // Farm's generic 500 body in both modes, not the server's own error response. A middleware
  // failure is kept out of shared caches, and a runtime hook failure sets no cache header.
  const internalServerError = {
    contentType: "application/json",
    body: '{"error":"Internal Server Error"}',
  };
  expect(thrown).toEqual({
    "/api/boom": internalServerError,
    "/api/before-fails": { ...internalServerError, cacheControl: null },
    "/api/after-fails": { ...internalServerError, cacheControl: null },
    "/api/mw-fails": { ...internalServerError, cacheControl: "private, no-store" },
    "/integration/boom": internalServerError,
  });

  if (pages) {
    await expectPageHookFailures(origin);
    await expectConfigRouteHookFailures(origin);
  }

  // A built-in route on a page path whose runtime.after throws answers the page's plain-text
  // 500, not the JSON an API path gets. A `renderer: false` app has no pages, so it answers JSON.
  expect(await request(origin, "/.well-known/farmjs.json?after-fails")).toEqual({
    ...(pages ? PAGE_HOOK_FAILURE : API_HOOK_FAILURE),
    trace: [
      "before page /.well-known/farmjs.json",
      "middleware /.well-known/farmjs.json",
      "after /.well-known/farmjs.json 200",
      "error /.well-known/farmjs.json after failed",
      "onError runtime after failed",
    ],
  });
}

const PAGE_HOOK_FAILURE = {
  status: 500,
  contentType: "text/plain; charset=utf-8",
  cacheControl: null,
  body: "Internal Server Error",
};

const API_HOOK_FAILURE = {
  status: 500,
  contentType: "application/json",
  cacheControl: null,
  body: '{"error":"Internal Server Error"}',
};

// On a page, a throwing runtime hook answers a plain-text 500: runtime.error observes it, onError
// gets it once as the "runtime" phase, and no later runtime.after runs. With an HTML transform
// hook, farm dev buffers the page before runtime.after sees it; the answer is the same.
async function expectPageHookFailures(origin: string): Promise<void> {
  const accept = { headers: { accept: "text/html" } };
  expect({
    "/hello/before-fails": await request(origin, "/hello/before-fails", accept),
    "/hello/after-fails": await request(origin, "/hello/after-fails", accept),
  }).toEqual({
    "/hello/before-fails": {
      ...PAGE_HOOK_FAILURE,
      trace: [
        "before page /hello/before-fails",
        "error /hello/before-fails before failed",
        "onError runtime before failed",
      ],
    },
    "/hello/after-fails": {
      ...PAGE_HOOK_FAILURE,
      trace: [
        "before page /hello/after-fails",
        "middleware /hello/after-fails",
        "after /hello/after-fails 200",
        "error /hello/after-fails after failed",
        "onError runtime after failed",
      ],
    },
  });
}

// A config redirect passes through the plugin runtime like any response, so a throwing runtime
// hook fails it as it fails a route: runtime.error observes it, onError gets it once as the
// "runtime" phase, and the answer is the runtime hook 500, plain text on a page path and JSON
// under the API base path. A runtime.before that throws on a config rewrite's destination fails
// the request opened for the requested URL the same way.
async function expectConfigRouteHookFailures(origin: string): Promise<void> {
  const init: RequestInit = { redirect: "manual", headers: { accept: "text/html" } };
  const jsonFailure = {
    status: 500,
    contentType: "application/json",
    cacheControl: null,
    body: '{"error":"Internal Server Error"}',
  };
  const redirected = await request(origin, "/hello/moved/ok", init);
  expect({ status: redirected.status, trace: redirected.trace }).toEqual({
    status: 307,
    trace: ["before page /hello/moved/ok", "after /hello/moved/ok 307"],
  });
  expect({
    "/hello/moved/before-fails": await request(origin, "/hello/moved/before-fails", init),
    "/hello/moved/after-fails": await request(origin, "/hello/moved/after-fails", init),
    "/api/moved/before-fails": await request(origin, "/api/moved/before-fails", init),
    "/api/moved/after-fails": await request(origin, "/api/moved/after-fails", init),
    "/hello/rewritten": await request(origin, "/hello/rewritten", init),
  }).toEqual({
    "/hello/moved/before-fails": {
      ...PAGE_HOOK_FAILURE,
      trace: [
        "before page /hello/moved/before-fails",
        "error /hello/moved/before-fails before failed",
        "onError runtime before failed",
      ],
    },
    "/hello/moved/after-fails": {
      ...PAGE_HOOK_FAILURE,
      trace: [
        "before page /hello/moved/after-fails",
        "after /hello/moved/after-fails 307",
        "error /hello/moved/after-fails after failed",
        "onError runtime after failed",
      ],
    },
    "/api/moved/before-fails": {
      ...jsonFailure,
      trace: [
        "before api /api/moved/before-fails",
        "error /api/moved/before-fails before failed",
        "onError runtime before failed",
      ],
    },
    "/api/moved/after-fails": {
      ...jsonFailure,
      trace: [
        "before api /api/moved/after-fails",
        "after /api/moved/after-fails 307",
        "error /api/moved/after-fails after failed",
        "onError runtime after failed",
      ],
    },
    "/hello/rewritten": {
      ...PAGE_HOOK_FAILURE,
      trace: [
        "before page /hello/rewritten",
        "before page /hello/before-fails",
        "error /hello/rewritten before failed",
        "onError runtime before failed",
      ],
    },
  });
}

// A throwing HTML transform hook (transformHTML or afterRender) fails the page as a throwing
// runtime hook does: runtime.error observes it, onError gets it once as the "runtime" phase, no
// runtime.after runs, and the page answers the plain-text 500.
async function expectHTMLTransformFailures(origin: string): Promise<void> {
  const accept = { headers: { accept: "text/html" } };
  expect({
    "/hello/transform-fails": await request(origin, "/hello/transform-fails", accept),
    "/hello/render-fails": await request(origin, "/hello/render-fails", accept),
  }).toEqual({
    "/hello/transform-fails": {
      ...PAGE_HOOK_FAILURE,
      trace: [
        "before page /hello/transform-fails",
        "middleware /hello/transform-fails",
        "error /hello/transform-fails transform failed",
        "onError runtime transform failed",
      ],
    },
    "/hello/render-fails": {
      ...PAGE_HOOK_FAILURE,
      trace: [
        "before page /hello/render-fails",
        "middleware /hello/render-fails",
        "error /hello/render-fails render failed",
        "onError runtime render failed",
      ],
    },
  });
}

// A router or render hook that throws fails the page as a throwing runtime hook does: runtime.error
// observes it, onError gets it once as the "runtime" phase, no runtime.after runs, and the page
// answers the plain-text 500.
async function expectRouterAndRenderHookFailures(origin: string): Promise<void> {
  const accept = { headers: { accept: "text/html" } };
  expect({
    "/hello/router-fails": await request(origin, "/hello/router-fails", accept),
    "/hello/render-before-fails": await request(origin, "/hello/render-before-fails", accept),
  }).toEqual({
    "/hello/router-fails": {
      ...PAGE_HOOK_FAILURE,
      trace: [
        "before page /hello/router-fails",
        "error /hello/router-fails router failed",
        "onError runtime router failed",
      ],
    },
    "/hello/render-before-fails": {
      ...PAGE_HOOK_FAILURE,
      trace: [
        "before page /hello/render-before-fails",
        "error /hello/render-before-fails render.before failed",
        "onError runtime render.before failed",
      ],
    },
  });
}

// A built-in route whose own handler throws (here the docs engine's layout wrap) fails the
// request as a throwing runtime hook does: runtime.error observes it, onError gets it once as the
// "runtime" phase, no runtime.after runs, and a page path answers the plain-text 500.
async function expectBuiltInRouteFailure(origin: string): Promise<void> {
  const docs = await request(origin, "/docs", { headers: { accept: "text/html" } });
  expect({ status: docs.status, trace: docs.trace }).toEqual({
    status: 200,
    trace: ["before docs /docs", "middleware /docs", "after /docs 200"],
  });
  expect(await request(origin, "/docs/layout-fails", { headers: { accept: "text/html" } })).toEqual(
    {
      ...PAGE_HOOK_FAILURE,
      trace: [
        "before docs /docs/layout-fails",
        "middleware /docs/layout-fails",
        "error /docs/layout-fails layout failed",
        "onError runtime layout failed",
      ],
    },
  );
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

describe("plugin runtime hooks for API, integration, and built-in route requests", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-plugin-runtime-api-");
    await expectRuntimeHookContract(await startDevelopment(root));
  }, 120_000);

  it("in a node-server production build", async () => {
    const root = await createApp("farm-prod-plugin-runtime-api-");
    await withProduction(root, expectRuntimeHookContract);
  }, 240_000);
});

// The API request path is renderer-neutral, so a backend-only app must see the same hooks. This
// is where the dev and production divergence #2633 fixed was first seen.
describe("plugin runtime hooks for API, integration, and built-in route requests with renderer: false", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-plugin-runtime-api-bare-", { renderer: false });
    await expectRuntimeHookContract(await startDevelopment(root), { pages: false });
  }, 120_000);

  it("in a node-server production build", async () => {
    const root = await createApp("farm-prod-plugin-runtime-api-bare-", { renderer: false });
    await withProduction(root, (origin) => expectRuntimeHookContract(origin, { pages: false }));
  }, 240_000);
});

describe("plugin runtime, router, render, and HTML transform hook failures on a page", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-plugin-runtime-html-", { htmlTransform: true });
    const origin = await startDevelopment(root);
    await expectPageHookFailures(origin);
    await expectHTMLTransformFailures(origin);
    await expectRouterAndRenderHookFailures(origin);
  }, 120_000);

  it("in a node-server production build", async () => {
    const root = await createApp("farm-prod-plugin-runtime-html-", { htmlTransform: true });
    await withProduction(root, async (origin) => {
      await expectPageHookFailures(origin);
      await expectHTMLTransformFailures(origin);
      await expectRouterAndRenderHookFailures(origin);
    });
  }, 240_000);
});

describe("plugin runtime hooks when a built-in route's handler throws", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-plugin-runtime-docs-", { docs: true });
    await expectBuiltInRouteFailure(await startDevelopment(root));
  }, 120_000);

  it("in a node-server production build", async () => {
    const root = await createApp("farm-prod-plugin-runtime-docs-", { docs: true });
    await withProduction(root, expectBuiltInRouteFailure);
  }, 240_000);
});
