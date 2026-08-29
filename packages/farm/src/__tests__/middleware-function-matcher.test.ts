import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { MiddlewareManager } from "../middleware/manager";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import type { MiddlewareContext, MiddlewareMatcher } from "../middleware/types";

const isBeta = (ctx: MiddlewareContext) => ctx.pathname.startsWith("/beta");
const never = () => false;

function createRequest(url: string): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.url = url;
  req.method = "GET";
  req.headers = { host: "localhost" };
  return req;
}

async function runDev(matcher: MiddlewareMatcher[], paths: string[]) {
  const seen: Array<{ path: string; params: Record<string, string> }> = [];
  const manager = new MiddlewareManager("/tmp", undefined, [
    {
      matcher,
      async handler(ctx, next) {
        seen.push({ path: ctx.request.url ?? "", params: { ...ctx.params } });
        await next();
      },
    },
  ]);
  for (const path of paths) {
    const req = createRequest(path);
    await manager.execute(req, new ServerResponse(req));
  }
  return seen;
}

async function runProduction(matcher: MiddlewareMatcher[], paths: string[]) {
  const seen: Array<{ path: string; params: Record<string, string> }> = [];
  const runner = createProductionMiddlewareRunner({
    config: [
      {
        matcher,
        handler(ctx) {
          seen.push({ path: ctx.pathname, params: { ...ctx.params } });
        },
      },
    ],
  });
  for (const path of paths) {
    await runner(new Request(`https://example.com${path}`));
  }
  return seen;
}

const paths = ["/beta/x", "/dashboard/home", "/other"];

describe.each([
  ["dev middleware manager", runDev],
  ["production middleware runtime", runProduction],
])("%s: function matcher in a matcher list", (_name, run) => {
  it("keeps checking later matchers when the function returns false", async () => {
    const seen = await run([isBeta, "/dashboard/:path*"], paths);
    expect(seen.map((entry) => entry.path)).toEqual(["/beta/x", "/dashboard/home"]);
  });

  it("matches the same paths regardless of matcher order", async () => {
    const functionFirst = await run([isBeta, "/dashboard/:path*"], paths);
    const stringFirst = await run(["/dashboard/:path*", isBeta], paths);
    expect(functionFirst.map((entry) => entry.path)).toEqual(
      stringFirst.map((entry) => entry.path),
    );
  });

  it("does not run the handler when every matcher is false", async () => {
    const seen = await run([never, never, "/admin/:path*"], paths);
    expect(seen).toEqual([]);
  });

  it("still matches when the function returns true", async () => {
    const seen = await run([never, isBeta], paths);
    expect(seen.map((entry) => entry.path)).toEqual(["/beta/x"]);
  });

  it("exposes params from a string matcher that follows a false function", async () => {
    const seen = await run([never, "/dashboard/[section]"], ["/dashboard/reports"]);
    expect(seen).toEqual([{ path: "/dashboard/reports", params: { section: "reports" } }]);
  });
});
