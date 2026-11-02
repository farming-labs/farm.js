// @vitest-environment node
// App middleware guards API routes in `farm dev` as it does in production, where the entry runs
// the middleware runner before it dispatches an API route. The dev API branch used to skip it, so
// a guard on /api/** held in a build and let every request through in development.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close().catch(() => {})));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

const FILES: Record<string, string> = {
  "farm.config.ts": `import { definePlugin } from "@farm.js/core/plugin";
export default {
  telemetry: false,
  middleware: [
    {
      matcher: ["/api/:path*"],
      handler(ctx, next) {
        if (ctx.request.headers["x-config"] !== "ok") {
          return new Response("blocked by config middleware", { status: 401 });
        }
        return next();
      },
    },
  ],
  plugins: [
    definePlugin({
      name: "test:plugin-route",
      routes: ({ route }) => [
        route.post("/api/plugin/echo", { handler: async (request) => Response.json(await request.json()) }),
      ],
    }),
  ],
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <>{children}</>; }`,
  "src/app/api/middleware.ts": `export function middleware(request) {
  if (request.headers.get("x-file") !== "ok") {
    return new Response("blocked by file middleware", { status: 401 });
  }
}`,
  "src/app/api/secret/route.ts": `export function GET() { return Response.json({ secret: true }); }`,
};

async function listen(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-api-mw-"));
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
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  for (const [file, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  const server = await createServer({ root, images: { provider: "none" } });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

describe("development API middleware", () => {
  it("runs config and file middleware before app and plugin API routes", async () => {
    const origin = await listen();
    const echo = (headers: Record<string, string>) =>
      fetch(`${origin}/api/plugin/echo`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: '{"hello":"farm"}',
      });

    for (const [request, body] of [
      [() => fetch(`${origin}/api/secret`, { headers: { "x-file": "ok" } }), "config"],
      [() => fetch(`${origin}/api/secret`, { headers: { "x-config": "ok" } }), "file"],
      [() => echo({ "x-file": "ok" }), "config"],
      [() => echo({ "x-config": "ok" }), "file"],
    ] as const) {
      const response = await request();
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 401,
        body: `blocked by ${body} middleware`,
      });
    }

    const passed = { "x-config": "ok", "x-file": "ok" };
    const secret = await fetch(`${origin}/api/secret`, { headers: passed });
    expect(await secret.json()).toEqual({ secret: true });
    // The body is still there for the route after middleware ran.
    const echoed = await echo(passed);
    expect(await echoed.json()).toEqual({ hello: "farm" });
  }, 60_000);
});
