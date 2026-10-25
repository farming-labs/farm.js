/** @vitest-environment node */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { MiddlewareManager } from "../middleware/manager";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import type { FarmMiddlewareConfig, MiddlewareFunction } from "../middleware/types";

// Config middleware on /alias rewrites into /secret, which file middleware guards.
function createApp(calls: string[]) {
  const config: FarmMiddlewareConfig = [
    {
      matcher: "/alias/:path*",
      handler: async (ctx, next) => {
        calls.push("alias");
        ctx.rewrite(`/secret/${ctx.params.path ?? ""}`);
        await next();
      },
    },
    {
      matcher: "/secret/:path*",
      handler: async (_ctx, next) => {
        calls.push("secret-config");
        await next();
      },
    },
    {
      // Rewrites back and forth: each middleware still runs only once.
      matcher: ["/ping", "/pong"],
      handler: async (ctx, next) => {
        calls.push(`ping-pong:${ctx.pathname}`);
        ctx.rewrite(ctx.pathname === "/ping" ? "/pong" : "/ping");
        await next();
      },
    },
  ];
  const handlers: Record<string, MiddlewareFunction> = {
    "/": async (_ctx, next) => {
      calls.push("root");
      await next();
    },
    "/secret": async (ctx) => {
      calls.push("secret-file");
      if (ctx.cookies.get("auth") !== "1") {
        return new Response("secret blocked", { status: 401 });
      }
    },
  };
  return { config, handlers };
}

async function runProduction(url: string, headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const { config, handlers } = createApp(calls);
  const runner = createProductionMiddlewareRunner({
    config,
    modules: Object.entries(handlers).map(([routePath, handler]) => ({
      path: routePath,
      filePath: `${routePath}/middleware.ts`,
      module: { default: handler },
    })),
  });
  const result = await runner(new Request(`http://localhost${url}`, { headers }));
  return { calls, status: result.response?.status ?? null, url: result.request.url };
}

async function runDevelopment(url: string, headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const { config, handlers } = createApp(calls);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-middleware-rewrite-"));
  const appDir = path.join(root, "src", "app");
  const files: Record<string, string> = {};
  for (const routePath of Object.keys(handlers)) {
    const filePath = path.join(appDir, routePath, "middleware.ts");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "export {};\n");
    files[filePath] = routePath;
  }
  try {
    const viteServer = {
      environments: {
        ssr: {
          runner: {
            import: async (filePath: string) => ({ default: handlers[files[filePath]!] }),
          },
        },
      },
    };
    const manager = new MiddlewareManager(appDir, viteServer as never, config);
    await manager.discover();
    const req = new IncomingMessage(new Socket());
    req.url = url;
    req.method = "GET";
    req.headers = { host: "localhost", ...headers };
    const res = new ServerResponse(req);
    const handled = await manager.execute(req, res);
    return { calls, status: handled ? res.statusCode : null, url: req.url };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe.each([
  ["production", runProduction],
  ["development", runDevelopment],
])("ctx.rewrite() target guards (%s)", (_mode, run) => {
  it("runs the rewrite target's file and config middleware", async () => {
    expect(await run("/alias/x")).toMatchObject({
      calls: ["alias", "root", "secret-config", "secret-file"],
      status: 401,
    });
    expect(await run("/secret/x")).toMatchObject({ status: 401 });
  });

  it("lets the rewrite through when the target's middleware allows it", async () => {
    const result = await run("/alias/x", { cookie: "auth=1" });
    expect(result.status).toBeNull();
    expect(result.calls).toEqual(["alias", "root", "secret-config", "secret-file"]);
    expect(result.url).toMatch(/\/secret\/x$/);
  });

  it("runs each middleware once when rewrites repeat", async () => {
    const result = await run("/ping");
    expect(result.status).toBeNull();
    expect(result.calls).toEqual(["ping-pong:/ping", "root"]);
  });
});
