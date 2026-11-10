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
  return /^\\/(api|integration)\\//.test(pathname) ||
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
          if (pathname.endsWith("/after-fails")) throw new Error("after failed");
        },
        error({ request, error }) {
          const pathname = traced(request);
          if (pathname) trace.push("error " + pathname + " " + (error as Error).message);
        },
      },
    }),
  ],
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/hello/page.tsx": `export default function Page() { return <h1>hello</h1>; }`,
  "src/app/hello/after-fails/page.tsx": `export default function Page() { return <h1>after</h1>; }`,
  "src/app/middleware.ts": `${TRACED}
export function middleware(request: Request) {
  const pathname = traced(request);
  if (!pathname) return;
  trace.push("middleware " + pathname);
  if (pathname === "/api/guarded" || pathname === "/.well-known/farmjs.json") {
    return new Response("guarded", { status: 401 });
  }
}`,
  "src/app/api/ok/route.ts": `export function GET() { return Response.json({ ok: true }); }`,
  "src/app/api/after-fails/route.ts": `export function GET() { return Response.json({ ok: true }); }`,
  "src/app/api/boom/route.ts": `export function GET(): Response { throw new Error("route failed"); }`,
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

async function expectRuntimeHookContract(origin: string): Promise<void> {
  const results: Record<string, { status: number; trace: string[] }> = {};
  const thrown: Record<string, { contentType: string | null; body: string }> = {};
  for (const pathname of [
    "/api/ok",
    "/api/blocked",
    "/api/guarded",
    "/api/missing",
    "/api/boom",
    "/api/before-fails",
    "/api/after-fails",
    "/integration/boom",
    "/.well-known/farmjs.json",
    "/hello",
  ]) {
    const response = await fetch(`${origin}${pathname}`);
    const body = await response.text();
    if (/\/(boom|before-fails|after-fails)$/.test(pathname)) {
      thrown[pathname] = { contentType: response.headers.get("content-type"), body };
    }
    const trace = await (await fetch(`${origin}/__trace`)).json();
    results[pathname] = { status: response.status, trace };
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
    "/hello": {
      status: 200,
      trace: ["before page /hello", "middleware /hello", "after /hello 200"],
    },
  });
  // A throwing API or integration route, and a throwing runtime hook on an API path, answer
  // Farm's generic 500 body in both modes, not the server's own error response.
  const internalServerError = {
    contentType: "application/json",
    body: '{"error":"Internal Server Error"}',
  };
  expect(thrown).toEqual({
    "/api/boom": internalServerError,
    "/api/before-fails": internalServerError,
    "/api/after-fails": internalServerError,
    "/integration/boom": internalServerError,
  });

  // On a page, a throwing runtime hook answers a plain-text 500.
  const pageFailures: Record<string, { status: number; contentType: string | null; body: string }> =
    {};
  for (const pathname of ["/hello/before-fails", "/hello/after-fails"]) {
    const response = await fetch(`${origin}${pathname}`, { headers: { accept: "text/html" } });
    pageFailures[pathname] = {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.text(),
    };
    await (await fetch(`${origin}/__trace`)).json();
  }
  const pageFailure = {
    status: 500,
    contentType: "text/plain; charset=utf-8",
    body: "Internal Server Error",
  };
  expect(pageFailures).toEqual({
    "/hello/before-fails": pageFailure,
    "/hello/after-fails": pageFailure,
  });
}

describe("plugin runtime hooks for API, integration, and built-in route requests", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-plugin-runtime-api-");
    const server = await createServer({ root });
    devServers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    await expectRuntimeHookContract(`http://localhost:${address.port}`);
  }, 120_000);

  it("in a node-server production build", async () => {
    const root = await createApp("farm-prod-plugin-runtime-api-");
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

      await expectRuntimeHookContract(origin);
    } finally {
      if (productionServer.exitCode === null) productionServer.kill();
      await exited;
    }
  }, 240_000);
});
