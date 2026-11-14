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

// The plugin records the request, kind and route each runtime hook sees, and serves the record
// from its own endpoint, which runs outside the request hooks, so a dev server and a production
// server can be asked the same questions. runtime.before throws on /posts/boom.
const FILES: Record<string, string> = {
  "farm.config.ts": `import { definePlugin } from "@farm.js/core";
const trace: string[] = ((globalThis as any).__farmRewriteRouteTest ??= []);
const describe = (event: { request: Request; kind: string; route?: any }) =>
  new URL(event.request.url).pathname + " " + event.kind + " " + event.route?.pathname + " " +
  (event.route?.pattern ?? null) + " " + JSON.stringify(event.route?.params ?? {});
const traced = (request: Request) => !new URL(request.url).pathname.startsWith("/__");
export default {
  images: { provider: "none" },
  telemetry: false,
  rewrites: () => [
    { source: "/alias", destination: "/hello" },
    { source: "/p/:slug", destination: "/posts/:slug" },
  ],
  plugins: [
    definePlugin({
      name: "acme:rewrite-route-trace",
      runtime: {
        endpoints: [{ path: "/__trace", handler: () => Response.json(trace.splice(0)) }],
        before(event) {
          if (!traced(event.request)) return;
          trace.push("before " + describe(event));
          if (new URL(event.request.url).pathname === "/posts/boom") throw new Error("boom");
        },
        after(event) {
          if (traced(event.request)) trace.push("after " + describe(event));
        },
        error(event) {
          if (traced(event.request)) trace.push("error " + describe(event));
        },
      },
    }),
  ],
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/hello/page.tsx": `export default function Page() { return <h1>hello</h1>; }`,
  "src/app/posts/[slug]/page.tsx": `export default function Page({ params }) { return <h1>post {params.slug}</h1>; }`,
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
  const response = await fetch(`${origin}${pathname}`, { headers: { accept: "text/html" } });
  const body = await response.text();
  return {
    status: response.status,
    body: body.includes("<h1>")
      ? body.slice(body.indexOf("<h1>"), body.indexOf("</h1>") + 5)
      : body,
    trace: (await (await fetch(`${origin}/__trace`)).json()) as string[],
  };
}

// A config rewrite's runtime session opens on the URL as requested, so runtime.before (on the
// source), runtime.after and runtime.error see the route the source URL matches, none here. Only
// the runtime.before that runs again on the destination sees the destination's route. The page
// still renders the destination.
async function expectRewriteRouteContract(origin: string): Promise<void> {
  const results: Record<string, unknown> = {};
  for (const pathname of ["/hello", "/alias", "/p/one", "/p/boom"]) {
    results[pathname] = await request(origin, pathname);
  }
  expect(results).toEqual({
    "/hello": {
      status: 200,
      body: "<h1>hello</h1>",
      trace: ["before /hello page /hello /hello {}", "after /hello page /hello /hello {}"],
    },
    "/alias": {
      status: 200,
      body: "<h1>hello</h1>",
      trace: [
        "before /alias page /alias null {}",
        "before /hello page /hello /hello {}",
        "after /alias page /alias null {}",
      ],
    },
    "/p/one": {
      status: 200,
      body: "<h1>post <!-- -->one</h1>",
      trace: [
        "before /p/one page /p/one null {}",
        'before /posts/one page /posts/one /posts/[slug] {"slug":"one"}',
        "after /p/one page /p/one null {}",
      ],
    },
    "/p/boom": {
      status: 500,
      body: "Internal Server Error",
      trace: [
        "before /p/boom page /p/boom null {}",
        'before /posts/boom page /posts/boom /posts/[slug] {"slug":"boom"}',
        "error /p/boom page /p/boom null {}",
      ],
    },
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

describe("plugin runtime route for a config rewrite", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-plugin-rewrite-route-");
    await expectRewriteRouteContract(await startDevelopment(root));
  }, 120_000);

  it("in a node-server production build", async () => {
    const root = await createApp("farm-prod-plugin-rewrite-route-");
    await withProduction(root, expectRewriteRouteContract);
  }, 240_000);
});
