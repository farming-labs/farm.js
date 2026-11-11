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

type Variant = { label: string; renderer: "react" | false };

// The same app with the default React renderer and as a backend-only `renderer: false` app: the
// API request path is renderer-neutral, so both must see the same hooks.
const VARIANTS: Variant[] = [
  { label: "with the React renderer", renderer: "react" },
  { label: "with renderer: false", renderer: false },
];

// The plugin records every runtime hook it sees and serves the record from its own endpoint,
// which runs outside the request hooks, so a dev server and a production server can be
// asked the same questions.
const farmConfig = ({ renderer }: Variant) => `import { definePlugin } from "@farm.js/core";
const trace: string[] = [];
const traced = (request: Request) => {
  const { pathname } = new URL(request.url);
  return pathname.startsWith("/api/") || pathname === "/hello" ? pathname : null;
};
export default {
  images: { provider: "none" },${renderer === false ? "\n  renderer: false," : ""}
  telemetry: false,
  plugins: [
    definePlugin({
      name: "acme:trace",
      runtime: {
        endpoints: [{ path: "/__trace", handler: () => Response.json(trace.splice(0)) }],
        before({ request, kind }) {
          const pathname = traced(request);
          if (!pathname) return;
          trace.push("before " + kind + " " + pathname);
          if (pathname === "/api/blocked") return new Response("blocked", { status: 403 });
        },
        after({ request, response }) {
          const pathname = traced(request);
          if (pathname) trace.push("after " + pathname + " " + response.status);
        },
        error({ request, error }) {
          const pathname = traced(request);
          if (pathname) trace.push("error " + pathname + " " + (error as Error).message);
        },
      },
    }),
  ],
};`;

const API_FILES: Record<string, string> = {
  "src/app/api/ok/route.ts": `export function GET() { return Response.json({ ok: true }); }`,
  "src/app/api/boom/route.ts": `export function GET(): Response { throw new Error("route failed"); }`,
};

const PAGE_FILES: Record<string, string> = {
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/hello/page.tsx": `export default function Page() { return <h1>hello</h1>; }`,
};

async function createApp(prefix: string, variant: Variant): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  // A backend-only app links only `@farm.js/core`, as in an app that never installed React.
  for (const name of variant.renderer === false ? [] : ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  const files = {
    "farm.config.ts": farmConfig(variant),
    ...API_FILES,
    ...(variant.renderer === false ? {} : PAGE_FILES),
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

async function expectRuntimeHookContract(origin: string, variant: Variant): Promise<void> {
  const hasPages = variant.renderer !== false;
  const results: Record<string, { status: number; trace: string[] }> = {};
  const pathnames = ["/api/ok", "/api/blocked", "/api/missing", "/api/boom"];
  if (hasPages) pathnames.push("/hello");
  for (const pathname of pathnames) {
    const response = await fetch(`${origin}${pathname}`);
    await response.arrayBuffer();
    const trace = await (await fetch(`${origin}/__trace`)).json();
    results[pathname] = { status: response.status, trace };
  }

  expect(results).toEqual({
    // A matched API route: before, then after on its response.
    "/api/ok": { status: 200, trace: ["before api /api/ok", "after /api/ok 200"] },
    // An unmatched API path still passes through runtime.before, so a guard answers it, and
    // runtime.after sees that early answer.
    "/api/blocked": {
      status: 403,
      trace: ["before api /api/blocked", "after /api/blocked 403"],
    },
    // Farm's JSON 404 for an unmatched API path is a response like any other.
    "/api/missing": {
      status: 404,
      trace: ["before api /api/missing", "after /api/missing 404"],
    },
    // A throwing API route: runtime.error observes the throw, then runtime.after sees the 500
    // Farm answers with.
    "/api/boom": {
      status: 500,
      trace: ["before api /api/boom", "error /api/boom route failed", "after /api/boom 500"],
    },
    // Page requests are unchanged.
    ...(hasPages
      ? { "/hello": { status: 200, trace: ["before page /hello", "after /hello 200"] } }
      : {}),
  });
}

describe.each(VARIANTS)("plugin runtime hooks for API requests $label", (variant) => {
  it("in development", async () => {
    const root = await createApp("farm-dev-plugin-runtime-api-", variant);
    const server = await createServer({ root });
    devServers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    await expectRuntimeHookContract(`http://localhost:${address.port}`, variant);
  }, 120_000);

  it("in a node-server production build", async () => {
    const root = await createApp("farm-prod-plugin-runtime-api-", variant);
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

      await expectRuntimeHookContract(origin, variant);
    } finally {
      if (productionServer.exitCode === null) productionServer.kill();
      await exited;
    }
  }, 240_000);
});
