import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
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

async function runDev(paths: string[]) {
  const seen: Seen[] = [];
  const manager = new MiddlewareManager(
    "/tmp",
    undefined,
    [
      {
        matcher: "/dashboard/:path*",
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

async function runProduction(paths: string[]) {
  const seen: Seen[] = [];
  const runner = createProductionMiddlewareRunner({
    config: [
      {
        matcher: "/dashboard/:path*",
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
    const seen = await run(["/console", "/console/dashboard"]);
    expect(seen.map((entry) => entry.path)).toEqual(["/console/dashboard"]);
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
