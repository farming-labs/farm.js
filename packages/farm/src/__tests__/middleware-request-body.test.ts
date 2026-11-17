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

/**
 * A request-first `middleware(request, context)` gets a Web Request, and reading its body is the
 * natural way to check a signed webhook or a JSON payload before the route. Doing so left the
 * route without its body: production answered 500 (the body was already used) and development
 * hung (the route waited on a Node stream the middleware had drained). Each middleware now gets a
 * request whose body it can read while the route still receives the whole body.
 */
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

const files: Record<string, string> = {
  "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false, server: { bodySizeLimit: 64 } };`,
  "src/app/layout.tsx":
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  "src/app/page.tsx": "export default function Home() { return <main>home</main>; }",
  // Two request-first middlewares read the same body before the route.
  "src/app/middleware.ts": `export async function middleware(request: Request, context: { headers: Headers }) {
  if (request.method !== "POST") return;
  context.headers.set("x-root-read", String((await request.text()).length));
}`,
  "src/app/api/echo/middleware.ts": `export async function middleware(request: Request, context: { headers: Headers }) {
  if (request.method !== "POST") return;
  const payload = await request.json();
  context.headers.set("x-route-read", String(payload.message));
}`,
  "src/app/api/echo/route.ts": `export const POST = async (request: Request) => Response.json({ received: await request.json() });
export const GET = () => Response.json({ received: null });`,
};

async function createApp(prefix: string): Promise<string> {
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

async function runInDevelopment(run: Run): Promise<void> {
  const server = await createServer({ root: await createApp("farm-mw-request-body-dev-") });
  devServers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  await run(`http://localhost:${address.port}`);
}

async function runInProduction(run: Run): Promise<void> {
  const root = await createApp("farm-mw-request-body-prod-");
  const config = await resolveConfig(
    { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
    "production",
  );
  await build(config, { root, preset: "node-server" });
  const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
  try {
    await run(server.origin);
  } finally {
    await server.stop();
  }
}

async function expectBodyReachesRoute(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("x-root-read")).toBe("16");
  expect(response.headers.get("x-route-read")).toBe("hi");
  expect(await response.json()).toEqual({ received: { message: "hi" } });

  // A request whose middleware reads no body is unchanged.
  const get = await fetch(`${origin}/api/echo`);
  expect(await get.json()).toEqual({ received: null });

  // The route still applies server.bodySizeLimit to a body middleware read.
  const large = await fetch(`${origin}/api/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "x".repeat(100) }),
  });
  expect(large.status).toBe(413);
}

describe("request-first middleware that reads the request body", () => {
  it("leaves the body for the route in development", async () => {
    await runInDevelopment(expectBodyReachesRoute);
  }, 120_000);

  it("leaves the body for the route in production", async () => {
    await runInProduction(expectBodyReachesRoute);
  }, 240_000);
});
