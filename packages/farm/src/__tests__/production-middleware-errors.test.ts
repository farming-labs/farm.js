// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig, type FarmUserConfig } from "../config";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Thrown by middleware and checked against every response body: it must stay in server logs.
const SECRET = "middleware-secret-detail";

const middlewareSource = `export function middleware(request: Request, context: { headers: Headers }) {
  const { pathname } = new URL(request.url);
  if (pathname === "/mw-throw" || pathname === "/api/mw-throw") {
    throw new Error(${JSON.stringify(SECRET)});
  }
  context.headers.set("x-middleware", "ran");
}`;

interface ProductionApp {
  origin: string;
  root: string;
  output: string[];
  stop(): Promise<void>;
}

async function startProductionApp(
  prefix: string,
  files: Record<string, string>,
  options: { linkReact: boolean; config?: FarmUserConfig; env?: Record<string, string> },
): Promise<ProductionApp> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  if (options.linkReact) {
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

async function readResponse(response: Response) {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    configured: response.headers.get("x-configured"),
    body: await response.text(),
  };
}

describe("production middleware errors", () => {
  let app: ProductionApp | undefined;
  let logPath = "";

  beforeAll(async () => {
    logPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "farm-mw-error-log-")), "log");
    app = await startProductionApp(
      "farm-production-mw-errors-",
      {
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
    return [{ source: "/:path*", headers: [{ key: "x-configured", value: "yes" }] }];
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
        },
        error({ error, request }) {
          record({ source: "runtime.error", pathname: new URL(request.url).pathname, message: error?.message });
        },
      },
    }),
  ],
});
`,
        "src/app/globals.css": "",
        "src/app/layout.tsx":
          "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
        "src/app/error.tsx":
          "export default function RootError() { return <p data-root-error>root-error-boundary</p>; }",
        "src/app/page.tsx": "export default function Home() { return <main>home</main>; }",
        "src/app/mw-throw/page.tsx":
          "export default function Page() { return <main>unreachable</main>; }",
        "src/app/boom/page.tsx": `export default function Boom() { throw new Error(${JSON.stringify(SECRET)}); }`,
        "src/app/api/mw-throw/route.ts":
          "export function GET() { return Response.json({ ok: true }); }",
        "src/app/api/boom/route.ts": `export function GET(): Response { throw new Error(${JSON.stringify(SECRET)}); }`,
        "src/app/middleware.ts": middlewareSource,
      },
      { linkReact: true, env: { FARM_MW_ERROR_LOG: logPath } },
    );
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
    await home.body?.cancel();

    const readTrace = async (pathname: string) => {
      await fs.writeFile(logPath, "");
      await fetch(`${app!.origin}${pathname}`).then((response) => response.text());
      return (await fs.readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    };

    const failure = { message: SECRET };
    expect(await readTrace("/api/boom")).toEqual([
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
    expect(await readTrace("/api/mw-throw")).toEqual([
      { source: "event", type: "middleware.error", pathname: "/api/mw-throw", ...failure },
      { source: "runtime.error", pathname: "/api/mw-throw", ...failure },
      { source: "onError", phase: "runtime", pathname: "/api/mw-throw", ...failure },
      {
        source: "runtime.after",
        pathname: "/api/mw-throw",
        status: 500,
        contentType: "application/json",
      },
    ]);
    expect(await readTrace("/mw-throw")).toEqual([
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
    // A plugin hook that throws still fails the request: runtime.error runs, runtime.after does not.
    expect(await readTrace("/plugin-throw")).toEqual([
      { source: "runtime.error", pathname: "/plugin-throw", message: "plugin-before-failed" },
      {
        source: "onError",
        phase: "runtime",
        pathname: "/plugin-throw",
        message: "plugin-before-failed",
      },
    ]);
    expect(app!.output.join("")).toContain(SECRET);
  });
});

describe("production middleware errors with renderer: false", () => {
  let app: ProductionApp | undefined;

  beforeAll(async () => {
    app = await startProductionApp(
      "farm-production-mw-errors-backend-",
      {
        "src/app/api/mw-throw/route.ts":
          "export function GET() { return Response.json({ ok: true }); }",
        "src/app/middleware.ts": middlewareSource,
      },
      { linkReact: false, config: { renderer: false, images: { provider: "none" } } },
    );
  }, 240_000);

  afterAll(async () => {
    await app?.stop();
  });

  it("answers JSON whatever the path", async () => {
    for (const pathname of ["/mw-throw", "/api/mw-throw"]) {
      const response = await readResponse(
        await fetch(`${app!.origin}${pathname}`, { headers: { accept: "text/html" } }),
      );
      expect(response, pathname).toMatchObject({ status: 500, cacheControl: "private, no-store" });
      expect(response.contentType, pathname).toMatch(/^application\/json/);
      expect(JSON.parse(response.body), pathname).toEqual({ error: "Internal Server Error" });
    }
  });
});
