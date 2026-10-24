import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveFarmI18nConfig } from "../i18n/config";
import { MiddlewareManager } from "../middleware/manager";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import type { MiddlewareContext } from "../middleware/types";

// The resolved config carries basePath even when i18n is disabled.
const i18n = resolveFarmI18nConfig(undefined, { basePath: "/console" });

function createRequest(url: string): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.url = url;
  req.method = "GET";
  req.headers = { host: "localhost" };
  return req;
}

type Seen = { path: string; params: Record<string, string | string[]> };

async function runDev(paths: string[], matcher = "/dashboard/:path*") {
  const seen: Seen[] = [];
  const manager = new MiddlewareManager(
    "/tmp",
    undefined,
    [
      {
        matcher,
        async handler(ctx: MiddlewareContext, next) {
          seen.push({ path: ctx.pathname, params: { ...ctx.params } });
          await next();
        },
      },
    ],
    i18n,
  );
  for (const path of paths) {
    const req = createRequest(path);
    await manager.execute(req, new ServerResponse(req));
  }
  return seen;
}

async function runProduction(paths: string[], matcher = "/dashboard/:path*") {
  const seen: Seen[] = [];
  const runner = createProductionMiddlewareRunner({
    config: [
      {
        matcher,
        handler(ctx) {
          seen.push({ path: ctx.pathname, params: { ...ctx.params } });
        },
      },
    ],
    i18n,
  });
  for (const path of paths) {
    await runner(new Request(`https://example.com${path}`));
  }
  return seen;
}

describe.each([
  ["dev middleware manager", runDev],
  ["production middleware runtime", runProduction],
])("%s: basePath without i18n", (_name, run) => {
  it("matches config matchers against the path beneath the basePath", async () => {
    const seen = await run(["/console/dashboard/reports", "/console/settings"]);

    expect(seen).toEqual([{ path: "/console/dashboard/reports", params: { path: "reports" } }]);
  });

  it("matches the basePath root as the app root", async () => {
    const seen = await run(["/console", "/console/dashboard"], "/");
    expect(seen.map((entry) => entry.path)).toEqual(["/console"]);
  });
});

describe("production middleware runtime: file middleware beneath a basePath", () => {
  it("runs a route-scoped middleware file for its page under the basePath", async () => {
    const ran: string[] = [];
    const runner = createProductionMiddlewareRunner({
      modules: [
        {
          path: "/dashboard",
          module: {
            default(ctx: MiddlewareContext) {
              ran.push(ctx.pathname);
            },
          },
        },
      ],
      i18n,
    });

    await runner(new Request("https://example.com/console/dashboard"));
    await runner(new Request("https://example.com/console/settings"));

    expect(ran).toEqual(["/console/dashboard"]);
  });
});

// `api: { basePath: "/v2/api" }` serves src/app/api/admin/users/route.ts at /v2/api/admin/users
// (and still at /api/admin/users). The guard in src/app/api/admin/middleware.ts is named for the
// canonical path, so it must run for both.
const apiPaths = ["/v2/api/admin/users", "/api/admin/users", "/v2/api/public", "/v2/apiadmin"];

async function guardedDev(matcher?: string) {
  const appDir = await mkdtemp(path.join(tmpdir(), "farm-api-base-path-middleware-"));
  try {
    await mkdir(path.join(appDir, "api", "admin"), { recursive: true });
    await writeFile(path.join(appDir, "api", "admin", "middleware.ts"), "");
    const viteServer = {
      environments: {
        ssr: {
          runner: { import: async () => ({ default: () => new Response("no", { status: 401 }) }) },
        },
      },
    };
    const seen: string[] = [];
    const manager = new MiddlewareManager(
      appDir,
      viteServer as never,
      matcher
        ? [{ matcher, handler: (ctx: MiddlewareContext) => void seen.push(ctx.pathname) }]
        : undefined,
      undefined,
      undefined,
      "/v2/api",
    );
    await manager.discover();
    const blocked: string[] = [];
    for (const url of apiPaths) {
      const req = createRequest(url);
      if (await manager.execute(req, new ServerResponse(req))) blocked.push(url);
    }
    return { blocked, seen };
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
}

async function guardedProduction(matcher?: string) {
  const seen: string[] = [];
  const runner = createProductionMiddlewareRunner({
    config: matcher
      ? [{ matcher, handler: (ctx: MiddlewareContext) => void seen.push(ctx.pathname) }]
      : undefined,
    modules: [
      {
        path: "/api/admin",
        module: { default: () => new Response("no", { status: 401 }) },
      },
    ],
    apiBasePath: "/v2/api",
  });
  const blocked: string[] = [];
  for (const url of apiPaths) {
    const result = await runner(new Request(`https://example.com${url}`));
    if (result.response?.status === 401) blocked.push(url);
  }
  return { blocked, seen };
}

describe.each([
  ["dev middleware manager", guardedDev],
  ["production middleware runtime", guardedProduction],
])("%s: api.basePath", (_name, run) => {
  it("runs src/app/api middleware for the public API path", async () => {
    const { blocked } = await run();
    expect(blocked).toEqual(["/v2/api/admin/users", "/api/admin/users"]);
  });

  it("matches config matchers written for either API prefix", async () => {
    // Both prefixes reach the same routes, so a matcher for one form guards the other.
    expect((await run("/v2/api/public")).seen).toEqual(["/v2/api/public"]);
    expect((await run("/api/public")).seen).toEqual(["/v2/api/public"]);
  });
});

describe("production middleware runtime: raw-path routing (RSC)", () => {
  it("matches the request path as well as the basePath-stripped path", async () => {
    const ran: string[] = [];
    const record = (name: string) => ({
      default(ctx: MiddlewareContext) {
        ran.push(`${name} ${ctx.pathname}`);
      },
    });
    const runner = createProductionMiddlewareRunner({
      config: [{ matcher: "/console/reports", handler: () => void ran.push("config") }],
      modules: [
        { path: "/console/reports", module: record("raw") },
        { path: "/reports", module: record("stripped") },
      ],
      i18n,
      rawPathRouting: true,
    });

    await runner(new Request("https://example.com/console/reports"));

    expect(ran).toEqual(["config", "raw /console/reports", "stripped /console/reports"]);
  });
});
