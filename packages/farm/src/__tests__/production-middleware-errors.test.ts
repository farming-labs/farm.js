// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig, type FarmUserConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Thrown by middleware and checked against every response body: it must stay in server logs.
const SECRET = "middleware-secret-detail";

const middlewareSource = `export function middleware(
  request: Request,
  context: { headers: Headers; cookies: { set(name: string, value: string): void } },
) {
  const { pathname } = new URL(request.url);
  if (pathname === "/mw-throw" || pathname === "/api/mw-throw") {
    throw new Error(${JSON.stringify(SECRET)});
  }
  context.headers.set("x-middleware", "ran");
  context.cookies.set("middleware", "ran");
}`;

const APP_FILES: Record<string, string> = {
  "src/app/globals.css": "",
  "src/app/layout.tsx":
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  "src/app/error.tsx":
    "export default function RootError() { return <p data-root-error>root-error-boundary</p>; }",
  "src/app/page.tsx": "export default function Home() { return <main>home</main>; }",
  "src/app/mw-throw/page.tsx":
    "export default function Page() { return <main>unreachable</main>; }",
  "src/app/boom/page.tsx": `export default function Boom() { throw new Error(${JSON.stringify(SECRET)}); }`,
  "src/app/api/mw-throw/route.ts": "export function GET() { return Response.json({ ok: true }); }",
  "src/app/api/boom/route.ts": `export function GET(): Response { throw new Error(${JSON.stringify(SECRET)}); }`,
  "src/app/middleware.ts": middlewareSource,
};

// renderer: false, with a plugin whose runtime hooks throw on some paths.
const BACKEND_FILES: Record<string, string> = {
  "farm.config.ts": `import { defineConfig, definePlugin } from "@farm.js/core";

export default defineConfig({
  renderer: false,
  images: { provider: "none" },
  telemetry: false,
  redirects: () => [{ source: "/moved/:rest", destination: "/api/mw-throw" }],
  plugins: [
    definePlugin({
      name: "test:backend-hook-errors",
      runtime: {
        before({ request }) {
          if (request.url.endsWith("/plugin-before-throw")) throw new Error("plugin-before-failed");
        },
        after({ request }) {
          if (request.url.endsWith("/plugin-after-throw")) throw new Error("plugin-after-failed");
        },
      },
    }),
  ],
});
`,
  "src/app/api/mw-throw/route.ts": "export function GET() { return Response.json({ ok: true }); }",
  "src/app/middleware.ts": middlewareSource,
};

interface ProductionApp {
  origin: string;
  root: string;
  output: string[];
  stop(): Promise<void>;
}

async function createApp(
  prefix: string,
  files: Record<string, string>,
  linkReact: boolean,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  if (linkReact) {
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
  }
  for (const [file, source] of Object.entries({
    "package.json": '{"private":true,"type":"module"}',
    ...files,
  })) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return root;
}

async function startProductionApp(
  prefix: string,
  files: Record<string, string>,
  options: { linkReact: boolean; config?: FarmUserConfig; env?: Record<string, string> },
): Promise<ProductionApp> {
  const root = await createApp(prefix, files, options.linkReact);
  const userConfig = options.config ?? (await loadConfig(root, undefined, "production"));
  const config = await resolveConfig({ ...userConfig, root }, "production");
  await build(config, { root, preset: "node-server" });

  const serverDirectory = path.join(root, ".farm", ".output", "server");
  const port = await getAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const output: string[] = [];
  const server = spawn(process.execPath, [path.join(serverDirectory, "index.mjs")], {
    cwd: serverDirectory,
    env: { ...process.env, ...options.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => output.push(String(chunk)));
  server.stderr?.on("data", (chunk) => output.push(String(chunk)));
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  const stop = async () => {
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await exited;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };

  let ready = false;
  for (let attempt = 0; attempt < 200 && !ready; attempt++) {
    if (server.exitCode !== null) break;
    ready = await fetch(`${origin}/_farm/health/ready`).then(
      (response) => response.ok,
      () => false,
    );
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) {
    await stop();
    throw new Error(`Production server did not become ready\n${output.join("")}`);
  }
  return { origin, root, output, stop };
}

async function startDevelopmentApp(
  prefix: string,
  files: Record<string, string>,
  options: { linkReact: boolean; config?: FarmUserConfig },
): Promise<{ origin: string; stop(): Promise<void> }> {
  const root = await createApp(prefix, files, options.linkReact);
  const server = await createServer({ ...options.config, root });
  const stop = async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    await server.listen(await getAvailablePort());
  } catch (error) {
    await stop();
    throw error;
  }
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return { origin: `http://localhost:${address.port}`, stop };
}

async function readResponse(response: Response) {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    configured: response.headers.get("x-configured"),
    body: await response.text(),
  };
}

// The app with a plugin and observability hook that record what they see to FARM_MW_ERROR_LOG.
const TRACED_APP_FILES: Record<string, string> = {
  "farm.config.ts": `import { appendFileSync } from "node:fs";
import { defineConfig, definePlugin } from "@farm.js/core";

function record(entry) {
  appendFileSync(process.env.FARM_MW_ERROR_LOG, JSON.stringify(entry) + "\\n");
}

export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  generateBuildId: () => "middleware-errors-test",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-configured", value: "yes" },
          { key: "set-cookie", value: "configured=yes; Path=/" },
        ],
      },
    ];
  },
  observability: {
    events: ["middleware.error", "render.error", "api.error"],
    onEvent(event) {
      record({ source: "event", type: event.type, pathname: event.pathname, message: event.error?.message });
    },
  },
  plugins: [
    definePlugin({
      name: "test:middleware-errors",
      onError({ phase, error, meta }) {
        record({ source: "onError", phase, pathname: meta?.pathname, message: error?.message });
      },
      beforeRender({ pathname }) {
        if (pathname === "/render-hook-throw") throw new Error("plugin-render-failed");
      },
      runtime: {
        before({ request }) {
          if (new URL(request.url).pathname === "/plugin-throw") throw new Error("plugin-before-failed");
        },
        after({ request, response }) {
          record({
            source: "runtime.after",
            pathname: new URL(request.url).pathname,
            status: response.status,
            contentType: response.headers.get("content-type"),
          });
          if (new URL(request.url).searchParams.has("after-throw")) throw new Error("plugin-after-failed");
        },
        error({ error, request }) {
          record({ source: "runtime.error", pathname: new URL(request.url).pathname, message: error?.message });
        },
      },
    }),
  ],
});
`,
  ...APP_FILES,
  "src/app/api/ok/route.ts": "export function GET() { return Response.json({ ok: true }); }",
  "src/app/render-hook-throw/page.tsx":
    "export default function Page() { return <main>unreachable</main>; }",
};

/** Requests `pathname` and returns its response with what the app recorded for it. */
async function readTrace(origin: string, logPath: string, pathname: string, init?: RequestInit) {
  await fs.writeFile(logPath, "");
  const response = await readResponse(await fetch(`${origin}${pathname}`, init));
  const trace = (await fs.readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  return { response, trace };
}

// Headers the connection sets, which differ between servers whatever the app answers.
const TRANSPORT_HEADERS = new Set([
  "connection",
  "content-length",
  "date",
  "keep-alive",
  "transfer-encoding",
]);

/**
 * Every header of `response` but the transport's and Cache-Control, with each Set-Cookie value.
 * Only production keeps a response app middleware let through out of shared caches (see the
 * middleware docs), so the cache policy is left out.
 */
function readHeaders(response: Response): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (!TRANSPORT_HEADERS.has(name) && name !== "cache-control") headers[name] = value;
  });
  headers["set-cookie"] = response.headers.getSetCookie();
  return headers;
}

// A runtime.after hook that throws after app middleware set a header and a cookie fails the
// request with a new 500, as production builds it: the headers() config applies, its Set-Cookie
// included, but no header or cookie of the response the hook failed on.
async function expectRuntimeHookFailureHeaders(origin: string, logPath: string): Promise<void> {
  const failures: Record<string, unknown> = {};
  for (const pathname of ["/?after-throw", "/api/ok?after-throw"]) {
    await fs.writeFile(logPath, "");
    const response = await fetch(`${origin}${pathname}`, { headers: { accept: "text/html" } });
    failures[pathname] = {
      status: response.status,
      headers: readHeaders(response),
      body: await response.text(),
      // The plugin hooks only: development still emits an api.error event for a runtime hook
      // that fails an API request, which production does not.
      trace: (await fs.readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.source !== "event"),
    };
  }
  const trace = (pathname: string, contentType: string) => [
    { source: "runtime.after", pathname, status: 200, contentType },
    { source: "runtime.error", pathname, message: "plugin-after-failed" },
    { source: "onError", phase: "runtime", pathname, message: "plugin-after-failed" },
  ];
  const configured = { "x-configured": "yes", "set-cookie": ["configured=yes; Path=/"] };
  expect(failures).toEqual({
    "/?after-throw": {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", ...configured },
      body: "Internal Server Error",
      trace: trace("/", "text/html; charset=utf-8"),
    },
    "/api/ok?after-throw": {
      status: 500,
      headers: { "content-type": "application/json", ...configured },
      body: '{"error":"Internal Server Error"}',
      trace: trace("/api/ok", "application/json"),
    },
  });
}

// What both modes answer and report for a throwing middleware and a throwing page hook.
async function expectSharedFailureTraces(origin: string, logPath: string): Promise<void> {
  const failure = { message: SECRET };
  // The middleware throw reaches runtime.error and onError once, and runtime.after sees the 500.
  expect(await readTrace(origin, logPath, "/api/mw-throw")).toEqual({
    response: {
      status: 500,
      contentType: "application/json",
      cacheControl: "private, no-store",
      configured: "yes",
      body: '{"error":"Internal Server Error"}',
    },
    trace: [
      { source: "event", type: "middleware.error", pathname: "/api/mw-throw", ...failure },
      { source: "runtime.error", pathname: "/api/mw-throw", ...failure },
      { source: "onError", phase: "runtime", pathname: "/api/mw-throw", ...failure },
      {
        source: "runtime.after",
        pathname: "/api/mw-throw",
        status: 500,
        contentType: "application/json",
      },
    ],
  });
  // On a page the same holds: runtime.error and onError observe the throw once, and
  // runtime.after sees the HTML 500. The body is the page's error document in production and
  // Vite's error page, with its overlay, in development, so only its kind is compared.
  const { response: pageResponse, trace: pageTrace } = await readTrace(
    origin,
    logPath,
    "/mw-throw",
    { headers: { accept: "text/html" } },
  );
  expect(pageResponse.body).toMatch(/^\s*<!DOCTYPE html>/i);
  expect({ response: { ...pageResponse, body: undefined }, trace: pageTrace }).toEqual({
    response: {
      status: 500,
      contentType: "text/html; charset=utf-8",
      cacheControl: "private, no-store",
      configured: "yes",
      body: undefined,
    },
    trace: [
      { source: "event", type: "middleware.error", pathname: "/mw-throw", ...failure },
      { source: "runtime.error", pathname: "/mw-throw", ...failure },
      { source: "onError", phase: "runtime", pathname: "/mw-throw", ...failure },
      {
        source: "runtime.after",
        pathname: "/mw-throw",
        status: 500,
        contentType: "text/html; charset=utf-8",
      },
    ],
  });
  // A plugin hook that throws still fails the request: runtime.error runs, onError gets it once,
  // and runtime.after does not run. The answer is Farm's, with the headers() config.
  expect(
    await readTrace(origin, logPath, "/plugin-throw", { headers: { accept: "text/html" } }),
  ).toEqual({
    response: {
      status: 500,
      contentType: "text/plain; charset=utf-8",
      cacheControl: null,
      configured: "yes",
      body: "Internal Server Error",
    },
    trace: [
      { source: "runtime.error", pathname: "/plugin-throw", message: "plugin-before-failed" },
      {
        source: "onError",
        phase: "runtime",
        pathname: "/plugin-throw",
        message: "plugin-before-failed",
      },
    ],
  });
  await expectRuntimeHookFailureHeaders(origin, logPath);
  await expectPageRenderFailureTraces(origin, logPath);
}

// A page that throws as it renders answers its error page, a 500 runtime.after sees, and no
// plugin hook reports it. A plugin's beforeRender hook runs inside the plugin runtime request, so
// its throw fails that request as a throwing runtime hook does: runtime.error observes it, onError
// gets it once as the "runtime" phase, no runtime.after runs, and the page answers the runtime
// hook 500 with the headers() config.
async function expectPageRenderFailureTraces(origin: string, logPath: string): Promise<void> {
  const accept = { headers: { accept: "text/html" } };
  const { response: pageResponse, trace: pageTrace } = await readTrace(
    origin,
    logPath,
    "/boom",
    accept,
  );
  expect(pageResponse.body).toMatch(/^\s*<!DOCTYPE html>/i);
  expect({
    response: { ...pageResponse, body: undefined },
    // The plugin hooks only: development emits the render.error event more than once.
    trace: pageTrace.filter((entry) => entry.source !== "event"),
  }).toEqual({
    response: {
      status: 500,
      contentType: "text/html; charset=utf-8",
      cacheControl: "private, no-store",
      configured: "yes",
      body: undefined,
    },
    trace: [
      {
        source: "runtime.after",
        pathname: "/boom",
        status: 500,
        contentType: "text/html; charset=utf-8",
      },
    ],
  });
  expect(await readTrace(origin, logPath, "/render-hook-throw", accept)).toEqual({
    response: {
      status: 500,
      contentType: "text/plain; charset=utf-8",
      cacheControl: null,
      configured: "yes",
      body: "Internal Server Error",
    },
    trace: [
      { source: "runtime.error", pathname: "/render-hook-throw", message: "plugin-render-failed" },
      {
        source: "onError",
        phase: "runtime",
        pathname: "/render-hook-throw",
        message: "plugin-render-failed",
      },
    ],
  });
}

// An app whose plugin has server hooks (onError and HTML transforms) but no runtime hooks.
const NO_RUNTIME_HOOKS_APP_FILES: Record<string, string> = {
  "farm.config.ts": `import { appendFileSync } from "node:fs";
import { defineConfig, definePlugin } from "@farm.js/core";

function record(entry) {
  appendFileSync(process.env.FARM_MW_ERROR_LOG, JSON.stringify(entry) + "\\n");
}

export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  plugins: [
    definePlugin({
      name: "test:no-runtime-hooks",
      onError({ phase, error, meta }) {
        record({ source: "onError", phase, pathname: meta?.pathname, message: error?.message });
      },
      transformHTML(html) {
        if (html.includes("transform-fails-marker")) throw new Error("transform failed");
        return html;
      },
      afterRender(html, { pathname }) {
        if (pathname === "/render-fails") throw new Error("render failed");
        return html;
      },
    }),
  ],
});
`,
  ...APP_FILES,
  "src/app/transform-fails/page.tsx":
    "export default function Page() { return <main>transform-fails-marker</main>; }",
  "src/app/render-fails/page.tsx": "export default function Page() { return <main>render</main>; }",
};

// A plugin with server hooks opens the plugin runtime for every request, runtime hooks or not, so
// a page failure reaches onError once as the "runtime" phase in both modes. A middleware throw
// answers the HTML 500 (the error document in production, Vite's error page in development), and
// a throwing HTML transform hook fails the request with the plain-text runtime hook 500. The app
// middleware let that request through, so production keeps the 500 out of shared caches, as it
// keeps the page it replaces, with or without a headers() config; development sets no cache header.
async function expectNoRuntimeHookFailureTraces(
  origin: string,
  logPath: string,
  production: boolean,
): Promise<void> {
  const accept = { headers: { accept: "text/html" } };
  const { response: pageResponse, trace: pageTrace } = await readTrace(
    origin,
    logPath,
    "/mw-throw",
    accept,
  );
  expect(pageResponse.body).toMatch(/^\s*<!DOCTYPE html>/i);
  expect({ response: { ...pageResponse, body: undefined }, trace: pageTrace }).toEqual({
    response: {
      status: 500,
      contentType: "text/html; charset=utf-8",
      cacheControl: "private, no-store",
      configured: null,
      body: undefined,
    },
    trace: [{ source: "onError", phase: "runtime", pathname: "/mw-throw", message: SECRET }],
  });
  const hookFailure = {
    status: 500,
    contentType: "text/plain; charset=utf-8",
    cacheControl: production ? "private, no-store" : null,
    configured: null,
    body: "Internal Server Error",
  };
  expect({
    "/transform-fails": await readTrace(origin, logPath, "/transform-fails", accept),
    "/render-fails": await readTrace(origin, logPath, "/render-fails", accept),
  }).toEqual({
    "/transform-fails": {
      response: hookFailure,
      trace: [
        {
          source: "onError",
          phase: "runtime",
          pathname: "/transform-fails",
          message: "transform failed",
        },
      ],
    },
    "/render-fails": {
      response: hookFailure,
      trace: [
        {
          source: "onError",
          phase: "runtime",
          pathname: "/render-fails",
          message: "render failed",
        },
      ],
    },
  });
}

// Development runs first: it renders pages, which it must do before a production build in this
// process loads React for production.
describe("page errors with a plugin that has no runtime hooks", () => {
  let logDirectory = "";
  let logPath = "";

  beforeAll(async () => {
    logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "farm-no-runtime-log-"));
    logPath = path.join(logDirectory, "log");
  });

  afterAll(async () => {
    if (logDirectory) await fs.rm(logDirectory, { recursive: true, force: true });
  });

  it("in development", async () => {
    // The dev server loads the config in this process.
    const previousLog = process.env.FARM_MW_ERROR_LOG;
    process.env.FARM_MW_ERROR_LOG = logPath;
    const app = await startDevelopmentApp(
      "farm-dev-no-runtime-hooks-",
      NO_RUNTIME_HOOKS_APP_FILES,
      { linkReact: true },
    );
    try {
      await expectNoRuntimeHookFailureTraces(app.origin, logPath, false);
    } finally {
      await app.stop();
      if (previousLog === undefined) delete process.env.FARM_MW_ERROR_LOG;
      else process.env.FARM_MW_ERROR_LOG = previousLog;
    }
  }, 120_000);

  it("in a node-server production build", async () => {
    const app = await startProductionApp(
      "farm-production-no-runtime-hooks-",
      NO_RUNTIME_HOOKS_APP_FILES,
      { linkReact: true, env: { FARM_MW_ERROR_LOG: logPath } },
    );
    try {
      await expectNoRuntimeHookFailureTraces(app.origin, logPath, true);
    } finally {
      await app.stop();
    }
  }, 240_000);
});

describe("production middleware errors", () => {
  let app: ProductionApp | undefined;
  let logPath = "";

  beforeAll(async () => {
    logPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "farm-mw-error-log-")), "log");
    app = await startProductionApp("farm-production-mw-errors-", TRACED_APP_FILES, {
      linkReact: true,
      env: { FARM_MW_ERROR_LOG: logPath },
    });
  }, 240_000);

  afterAll(async () => {
    await app?.stop();
    if (logPath) {
      await fs.rm(path.dirname(logPath), { recursive: true, force: true });
    }
  });

  it("answers a page request with the error document a page render error gets", async () => {
    const accept = { accept: "text/html" };
    const pageError = await readResponse(await fetch(`${app!.origin}/boom`, { headers: accept }));
    const middlewareError = await readResponse(
      await fetch(`${app!.origin}/mw-throw`, { headers: accept }),
    );

    expect(pageError.status).toBe(500);
    expect(middlewareError).toMatchObject({
      status: 500,
      contentType: pageError.contentType,
      cacheControl: "private, no-store",
      configured: "yes",
    });
    expect(middlewareError.contentType).toMatch(/^text\/html/);
    expect(middlewareError.body).toMatch(/^<!DOCTYPE html>/i);
    expect(middlewareError.body).toContain("root-error-boundary");
    expect(middlewareError.body).not.toContain('"unhandled"');
    expect(middlewareError.body).not.toContain(SECRET);
  });

  it("answers a Markdown request with the error document as Markdown", async () => {
    const accept = { accept: "text/markdown" };
    const pageError = await readResponse(await fetch(`${app!.origin}/boom`, { headers: accept }));
    const middlewareError = await readResponse(
      await fetch(`${app!.origin}/mw-throw`, { headers: accept }),
    );

    expect(pageError).toMatchObject({ status: 500, contentType: "text/markdown; charset=utf-8" });
    expect(middlewareError).toMatchObject({
      status: 500,
      contentType: pageError.contentType,
      cacheControl: "private, no-store",
      configured: "yes",
    });
    expect(middlewareError.body).toContain("root-error-boundary");
    expect(middlewareError.body).not.toContain(SECRET);
  });

  it("answers an API request with the JSON a throwing API route gets", async () => {
    const routeError = await readResponse(await fetch(`${app!.origin}/api/boom`));
    const middlewareError = await readResponse(await fetch(`${app!.origin}/api/mw-throw`));

    expect(routeError.status).toBe(500);
    expect(middlewareError).toMatchObject({
      status: 500,
      contentType: routeError.contentType,
      configured: "yes",
    });
    expect(JSON.parse(middlewareError.body)).toEqual(JSON.parse(routeError.body));
    expect(JSON.parse(middlewareError.body)).toEqual({ error: "Internal Server Error" });
    expect(middlewareError.cacheControl).toBe("private, no-store");
  });

  it("reports the failure to runtime.error and the 500 to runtime.after, like an API route", async () => {
    // A middleware that did not throw still applies its headers.
    const home = await fetch(`${app!.origin}/`);
    expect(home.status).toBe(200);
    expect(home.headers.get("x-middleware")).toBe("ran");
    expect(home.headers.getSetCookie()).toContain("middleware=ran; Path=/");
    await home.body?.cancel();

    const failure = { message: SECRET };
    expect((await readTrace(app!.origin, logPath, "/api/boom")).trace).toEqual([
      { source: "event", type: "api.error", pathname: "/api/boom", ...failure },
      { source: "runtime.error", pathname: "/api/boom", ...failure },
      { source: "onError", phase: "runtime", pathname: "/api/boom", ...failure },
      {
        source: "runtime.after",
        pathname: "/api/boom",
        status: 500,
        contentType: "application/json",
      },
    ]);
    expect((await readTrace(app!.origin, logPath, "/mw-throw")).trace).toEqual([
      { source: "event", type: "middleware.error", pathname: "/mw-throw", ...failure },
      { source: "runtime.error", pathname: "/mw-throw", ...failure },
      { source: "onError", phase: "runtime", pathname: "/mw-throw", ...failure },
      {
        source: "runtime.after",
        pathname: "/mw-throw",
        status: 500,
        contentType: "text/html; charset=utf-8",
      },
    ]);
    await expectSharedFailureTraces(app!.origin, logPath);
    expect(app!.output.join("")).toContain(SECRET);
  });

  // The same policy as the app without a headers() config (expectNoRuntimeHookFailureTraces): a
  // runtime hook 500 on a request middleware let through stays private, and one that failed
  // before the request reached the app sets no cache header.
  it("keeps a runtime hook 500 private when middleware let the request through", async () => {
    const accept = { headers: { accept: "text/html" } };
    const cacheControl: Record<string, string | null> = {};
    for (const pathname of ["/?after-throw", "/api/ok?after-throw", "/plugin-throw"]) {
      const response = await readResponse(await fetch(`${app!.origin}${pathname}`, accept));
      expect(response.status, pathname).toBe(500);
      cacheControl[pathname] = response.cacheControl;
    }
    expect(cacheControl).toEqual({
      "/?after-throw": "private, no-store",
      "/api/ok?after-throw": "private, no-store",
      "/plugin-throw": null,
    });
  });
});

describe("production middleware errors with renderer: false", () => {
  let app: ProductionApp | undefined;

  beforeAll(async () => {
    app = await startProductionApp("farm-production-mw-errors-backend-", BACKEND_FILES, {
      linkReact: false,
    });
  }, 240_000);

  afterAll(async () => {
    await app?.stop();
  });

  it("answers JSON whatever the path", async () => {
    await expectBackendMiddlewareErrors(app!.origin);
  });

  it("answers JSON whatever the path when a plugin runtime hook throws", async () => {
    await expectBackendRuntimeHookErrors(app!.origin);
  });
});

async function expectBackendMiddlewareErrors(origin: string): Promise<void> {
  for (const pathname of ["/mw-throw", "/api/mw-throw"]) {
    const response = await readResponse(
      await fetch(`${origin}${pathname}`, { headers: { accept: "text/html" } }),
    );
    expect(response, pathname).toMatchObject({ status: 500, cacheControl: "private, no-store" });
    expect(response.contentType, pathname).toMatch(/^application\/json/);
    expect(JSON.parse(response.body), pathname).toEqual({ error: "Internal Server Error" });
  }
}

async function expectBackendRuntimeHookErrors(origin: string): Promise<void> {
  for (const pathname of [
    "/plugin-before-throw",
    "/plugin-after-throw",
    "/api/plugin-before-throw",
    "/api/plugin-after-throw",
    // A config redirect passes through the runtime hooks too.
    "/moved/plugin-before-throw",
    "/moved/plugin-after-throw",
  ]) {
    const response = await readResponse(
      await fetch(`${origin}${pathname}`, { headers: { accept: "text/html" }, redirect: "manual" }),
    );
    expect(response, pathname).toMatchObject({
      status: 500,
      contentType: "application/json",
      body: '{"error":"Internal Server Error"}',
    });
  }
}

// Development renders its own error page for a page, but answers what production answers on
// the wire otherwise, and keeps every middleware failure out of shared caches.
describe("development middleware errors", () => {
  it("answers an API request with production's JSON 500, kept out of shared caches", async () => {
    const app = await startDevelopmentApp("farm-dev-mw-errors-", APP_FILES, {
      linkReact: true,
      config: { images: { provider: "none" }, telemetry: false },
    });
    try {
      const middlewareError = await readResponse(await fetch(`${app.origin}/api/mw-throw`));
      expect(middlewareError).toMatchObject({
        status: 500,
        contentType: "application/json",
        cacheControl: "private, no-store",
      });
      expect(JSON.parse(middlewareError.body)).toEqual({ error: "Internal Server Error" });

      // The page's error response is Vite's development page, but just as uncacheable.
      const pageError = await readResponse(
        await fetch(`${app.origin}/mw-throw`, { headers: { accept: "text/html" } }),
      );
      expect(pageError).toMatchObject({ status: 500, cacheControl: "private, no-store" });
    } finally {
      await app.stop();
    }
  }, 120_000);

  it("reports a throwing middleware and a throwing page hook as production does", async () => {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-mw-error-log-"));
    const logPath = path.join(logDirectory, "log");
    // The dev server loads the config in this process.
    const previousLog = process.env.FARM_MW_ERROR_LOG;
    process.env.FARM_MW_ERROR_LOG = logPath;
    const app = await startDevelopmentApp("farm-dev-mw-errors-traced-", TRACED_APP_FILES, {
      linkReact: true,
    });
    try {
      await expectSharedFailureTraces(app.origin, logPath);
    } finally {
      await app.stop();
      if (previousLog === undefined) delete process.env.FARM_MW_ERROR_LOG;
      else process.env.FARM_MW_ERROR_LOG = previousLog;
      await fs.rm(logDirectory, { recursive: true, force: true });
    }
  }, 120_000);

  it("answers JSON whatever the path with renderer: false", async () => {
    const app = await startDevelopmentApp("farm-dev-mw-errors-backend-", BACKEND_FILES, {
      linkReact: false,
    });
    try {
      await expectBackendMiddlewareErrors(app.origin);
      await expectBackendRuntimeHookErrors(app.origin);
    } finally {
      await app.stop();
    }
  }, 120_000);
});
